"""
NotificationService — Servicio central de notificaciones académicas.

Flujo por cada notificación:
  1. _is_muted()  → descarta si el usuario tiene silenciado ese tipo/curso.
  2. Crea Notification en MySQL.
  3. _emit_to_user() → emite via SocketIO al room 'user_{id}'.
  4. Invalida caché Redis del contador de no leídas.

Uso:
    from services.notification_service import NotificationService, NotificationType
    NotificationService.create(
        user_id=5,
        type=NotificationType.COMMENT_ADDED,
        title="El profesor comentó tu texto",
        message="Ha dejado un comentario en el párrafo 2",
        url="/invite/abc123",
        metadata={"document_id": 42, "comment_id": 7}
    )
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from flask import current_app

from models.models import Notification, NotificationType, UserNotificationPreference
from settings.extensions import db, redis_client

logger = logging.getLogger(__name__)

# TTL del caché del badge de no leídas (segundos)
_UNREAD_CACHE_TTL = 30
_UNREAD_CACHE_KEY = "notif:unread:{user_id}"


class NotificationService:
    """Servicio central para crear y distribuir notificaciones en tiempo real."""

    # ------------------------------------------------------------------
    # Creación
    # ------------------------------------------------------------------

    @staticmethod
    def create(
        user_id: int | None = None,
        student_id: int | None = None,
        type: NotificationType = NotificationType.SYSTEM_UPDATE,
        title: str = "",
        message: str = "",
        url: str | None = None,
        priority: int = 2,
        metadata: dict | None = None,
        course_id: int | None = None,
    ) -> Optional[Notification]:
        """
        Crea una notificación si el usuario no la tiene silenciada.

        Guarda en MySQL → emite vía SocketIO → invalida caché Redis.

        Args:
            user_id:   ID del usuario destinatario.
            type:      Tipo del enum NotificationType.
            title:     Título corto (máx. 200 chars).
            message:   Mensaje descriptivo.
            url:       Deep-link al recurso (ruta relativa, ej: '/invite/token').
            priority:  1=crítica, 2=normal, 3=info.
            metadata:  Dict con datos extra (document_id, comment_id, etc.).
            course_id: workspace_id del curso, para verificar silencio por curso.

        Returns:
            La notificación creada, o None si el usuario la tiene silenciada.
        """
        if not user_id and not student_id:
            return None

        if user_id and NotificationService._is_muted(user_id, type, course_id):
            return None

        notif = Notification(
            user_id=user_id,
            student_id=student_id,
            type=type,
            title=title[:200],
            message=message,
            url=url,
            priority=priority,
            metadata_=metadata or {},
        )
        try:
            db.session.add(notif)
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.error(f"[NotificationService] Error al guardar notificación: {exc}")
            return None

        # Invalida caché del badge
        if user_id:
            NotificationService._invalidate_unread_cache(user_id, is_student=False)
            NotificationService._emit_to_user(user_id, notif, is_student=False)
        elif student_id:
            NotificationService._invalidate_unread_cache(student_id, is_student=True)
            NotificationService._emit_to_user(student_id, notif, is_student=True)

        return notif

    @staticmethod
    def create_bulk(
        user_ids: list[int],
        type: NotificationType,
        title: str,
        message: str,
        url: str | None = None,
        priority: int = 2,
        metadata: dict | None = None,
        course_id: int | None = None,
    ) -> list[Notification]:
        """
        Crea la misma notificación para múltiples usuarios.

        Útil para: Modo Revisión Final activado (todos los colaboradores),
        deadline reminder, etc.

        Returns:
            Lista de Notification creadas (excluye las silenciadas).
        """
        created: list[Notification] = []
        for uid in user_ids:
            notif = NotificationService.create(
                user_id=uid,
                type=type,
                title=title,
                message=message,
                url=url,
                priority=priority,
                metadata=metadata,
                course_id=course_id,
            )
            if notif:
                created.append(notif)
        return created

    # ------------------------------------------------------------------
    # Lectura / estado
    # ------------------------------------------------------------------

    @staticmethod
    def mark_read(notification_id: int, id: int, is_student: bool = False) -> bool:
        """Marca una única notificación como leída."""
        if is_student:
            notif = Notification.query.filter_by(id=notification_id, student_id=id).first()
        else:
            notif = Notification.query.filter_by(id=notification_id, user_id=id).first()

        if not notif:
            return False
        
        if not notif.read:
            notif.read = True
            db.session.commit()
            NotificationService._invalidate_unread_cache(id, is_student)
            
            # Emitir actualización de contador via SocketIO
            NotificationService._emit_unread_update(id, is_student)
            
        return True

    @staticmethod
    def mark_all_read(id: int, is_student: bool = False) -> bool:
        """Marca todas las notificaciones del usuario como leídas."""
        if is_student:
             db.session.query(Notification).filter_by(student_id=id, read=False).update({'read': True})
        else:
             db.session.query(Notification).filter_by(user_id=id, read=False).update({'read': True})
        
        db.session.commit()
        NotificationService._invalidate_unread_cache(id, is_student)
        
        # Emitir actualización de contador via SocketIO
        NotificationService._emit_unread_update(id, is_student)
        return True

    @staticmethod
    def get_unread_count(id: int, is_student: bool = False) -> int:
        """
        Retorna el total de notificaciones no leídas del usuario (profe o alumno).
        """
        prefix = "student" if is_student else "user"
        cache_key = f"notif:unread:{prefix}:{id}"
        
        try:
            cached = redis_client.get(cache_key)
            if cached is not None:
                return int(cached)
        except Exception:
            pass

        if is_student:
            count = Notification.query.filter_by(student_id=id, read=False).count()
        else:
            count = Notification.query.filter_by(user_id=id, read=False).count()
            
        try:
            redis_client.setex(cache_key, _UNREAD_CACHE_TTL, count)
        except Exception:
            pass
        return count

    @staticmethod
    def get_recent(
        id: int,
        is_student: bool = False,
        limit: int = 8,
        type_filter: str | None = None,
        types_filter: list[str] | None = None,
    ) -> list[dict]:
        """Retorna las últimas notificaciones serializadas."""
        if is_student:
            query = Notification.query.filter_by(student_id=id)
        else:
            query = Notification.query.filter_by(user_id=id)

        if types_filter:
            valid = []
            for t in types_filter:
                try:
                    valid.append(NotificationType(t))
                except ValueError:
                    pass
            if valid:
                query = query.filter(Notification.type.in_(valid))
        elif type_filter:
            try:
                nt = NotificationType(type_filter)
                query = query.filter_by(type=nt)
            except ValueError:
                pass
        notifications = (
            query.order_by(Notification.created_at.desc()).limit(limit).all()
        )
        return [n.to_dict() for n in notifications]

    @staticmethod
    def get_weekly_stats(id: int, is_student: bool = False) -> dict:
        """Estadísticas de la semana (v3)."""
        from datetime import timedelta
        week_ago = datetime.utcnow() - timedelta(days=7)

        if is_student:
            total_week = Notification.query.filter(
                Notification.student_id == id,
                Notification.created_at >= week_ago
            ).count()
        else:
            total_week = Notification.query.filter(
                Notification.user_id == id,
                Notification.created_at >= week_ago
            ).count()

        # Feedback stats (especialmente para profes)
        feedback_types = [
            NotificationType.COMMENT_ADDED,
            NotificationType.COMMENT_REPLIED,
            NotificationType.FEEDBACK_REQUESTED
        ]
        
        if is_student:
             feedback_total = Notification.query.filter(
                Notification.student_id == id,
                Notification.type.in_(feedback_types),
                Notification.created_at >= week_ago,
            ).count()
        else:
            feedback_total = Notification.query.filter(
                Notification.user_id == id,
                Notification.type.in_(feedback_types),
                Notification.created_at >= week_ago,
            ).count()

        if is_student:
            feedback_read = Notification.query.filter(
                Notification.student_id == id,
                Notification.type.in_(feedback_types),
                Notification.created_at >= week_ago,
                Notification.read == True,  # noqa: E712
            ).count()
        else:
            feedback_read = Notification.query.filter(
                Notification.user_id == id,
                Notification.type.in_(feedback_types),
                Notification.created_at >= week_ago,
                Notification.read == True,  # noqa: E712
            ).count()

        response_rate = (
            round((feedback_read / feedback_total) * 100)
            if feedback_total > 0
            else 100
        )

        return {
            'total_this_week': total_week,
            'unread_count':    NotificationService.get_unread_count(id, is_student),
            'response_rate':   response_rate,
        }

    # ------------------------------------------------------------------
    # Preferencias / silencio
    # ------------------------------------------------------------------

    @staticmethod
    def _is_muted(
        user_id: int,
        type: NotificationType,
        course_id: int | None = None,
    ) -> bool:
        """
        Verifica si el usuario tiene silenciada esta notificación.

        Comprueba (en orden):
          1. muted_until (silencio general temporal)
          2. muted_types (tipos silenciados permanentemente)
          3. muted_courses (curso/workspace silenciado)
        """
        pref = UserNotificationPreference.query.filter_by(user_id=user_id).first()
        if not pref:
            return False

        # 1. Silencio general temporal
        if pref.muted_until and datetime.utcnow() < pref.muted_until:
            return True

        # 2. Tipo silenciado
        muted_types: list = pref.muted_types or []
        if type.value in muted_types:
            return True

        # 3. Curso/workspace silenciado
        if course_id is not None:
            muted_courses: list = pref.muted_courses or []
            if course_id in muted_courses:
                return True

        return False

    @staticmethod
    def _emit_unread_update(id: int, is_student: bool = False) -> None:
        """Emite solo el contador de no leídas."""
        prefix = "student" if is_student else "user"
        room_name = f"{prefix}_{id}"
        try:
            from settings.extensions import socketio as sio
            count = NotificationService.get_unread_count(id, is_student)
            sio.emit('notification:count_update', {'count': count}, room=room_name)
        except Exception:
            pass

    @staticmethod
    def _invalidate_unread_cache(id: int, is_student: bool = False) -> None:
        """Elimina la clave de caché de no leídas."""
        prefix = "student" if is_student else "user"
        cache_key = f"notif:unread:{prefix}:{id}"
        try:
            redis_client.delete(cache_key)
        except Exception:
            pass

    @staticmethod
    def _emit_to_user(id: int, notification: Notification, is_student: bool = False) -> None:
        """
        Emite la notificación vía SocketIO al room personal del usuario/estudiante.
        """
        prefix = "student" if is_student else "user"
        room_name = f"{prefix}_{id}"
        
        try:
            from settings.extensions import socketio as sio
            payload = notification.to_dict()
            payload['unread_count'] = NotificationService.get_unread_count(id, is_student)
            
            logger.info(f"[NotificationService] Emitting 'notification:new' to room '{room_name}' (priority={notification.priority})")
            sio.emit('notification:new', payload, room=room_name)

            # Badge update independiente
            sio.emit(
                'notification:count_update',
                {'count': payload['unread_count']},
                room=room_name,
            )
        except Exception as exc:
            current_app.logger.warning(
                f"[NotificationService] SocketIO emit fallido para {prefix} {id}: {exc}"
            )
