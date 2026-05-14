"""
Blueprint de notificaciones académicas.

Endpoints:
  GET  /notifications/               → página completa (historial + filtros)
  GET  /notifications/dropdown       → JSON para el dropdown (últimas 8)
  POST /notifications/<id>/read      → marcar una como leída
  POST /notifications/read-all       → marcar todas como leídas
  GET  /notifications/unread-count   → JSON {"count": N} para el badge
  POST /notifications/preferences    → guardar preferencias del usuario
  POST /notifications/<id>/mute      → silenciar tipo: {"duration": "1h"|"24h"|"always"}

Seguridad:
  - Todos los endpoints requieren @login_required.
  - Siempre se filtra por current_user.id antes de operar.
  - Rate limiting en endpoints POST: 60 req/min.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, render_template, request, current_app
from flask_login import current_user, login_required

from models.models import Notification, NotificationType, UserNotificationPreference
from services.notification_service import NotificationService
from settings.extensions import db, limiter

notifications_bp = Blueprint(
    'notifications',
    __name__,
    url_prefix='/notifications',
)


# ---------------------------------------------------------------------------
# Página completa
# ---------------------------------------------------------------------------

@notifications_bp.route('/', methods=['GET'])
@login_required
def index():
    """Historial completo de notificaciones con filtros."""
    type_filter = request.args.get('type')
    page = request.args.get('page', 1, type=int)
    per_page = 20

    query = Notification.query.filter_by(user_id=current_user.id)
    if type_filter:
        try:
            query = query.filter_by(type=NotificationType(type_filter))
        except ValueError:
            pass

    pagination = query.order_by(Notification.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    notifications = [n.to_dict() for n in pagination.items]
    unread_count = NotificationService.get_unread_count(current_user.id)

    # Si la request es AJAX devuelve JSON, si no renderiza la plantilla
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({
            'notifications': notifications,
            'unread_count':  unread_count,
            'total':         pagination.total,
            'pages':         pagination.pages,
            'current_page':  page,
        })

    return render_template(
        'sections/notifications.html',
        notifications=notifications,
        unread_count=unread_count,
        pagination=pagination,
        notification_types=[nt.value for nt in NotificationType],
    )


# ---------------------------------------------------------------------------
# Dropdown
# ---------------------------------------------------------------------------

@notifications_bp.route('/dropdown', methods=['GET'])
@login_required
def dropdown():
    """
    Retorna las últimas 8 notificaciones para el dropdown de la navbar.

    Query param opcional: ?type=comment_added
    """
    type_filter  = request.args.get('type')
    types_param  = request.args.get('types')          # e.g. "section_edited,comment_resolved"
    types_filter = [t.strip() for t in types_param.split(',')] if types_param else None
    notifications = NotificationService.get_recent(
        current_user.id,
        is_student=False,
        limit=10,
        type_filter=type_filter,
        types_filter=types_filter,
    )
    unread_count = NotificationService.get_unread_count(current_user.id)
    stats = NotificationService.get_weekly_stats(current_user.id)

    return jsonify({
        'notifications': notifications,
        'unread_count':  unread_count,
        'count':         unread_count,  # Legacy support for home_notifications.js
        'stats':         stats,
    })


# ---------------------------------------------------------------------------
# Marcar como leída
# ---------------------------------------------------------------------------

@notifications_bp.route('/<int:notif_id>/read', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def mark_read(notif_id: int):
    """Marca una notificación como leída. Solo opera sobre las del usuario actual."""
    # Verificamos primero que existe y pertenece al usuario
    notif = Notification.query.filter_by(
        id=notif_id,
        user_id=current_user.id,
    ).first_or_404()

    try:
        success = NotificationService.mark_read(notif_id, current_user.id)
        return jsonify({'success': success})
    except Exception as exc:
        current_app.logger.error(
            f"[notifications] Error mark_read({notif_id}, user={current_user.id}): {exc}"
        )
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Marcar todas como leídas
# ---------------------------------------------------------------------------

@notifications_bp.route('/read-all', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def read_all():
    """Marca todas las notificaciones no leídas del usuario actual como leídas."""
    try:
        count = NotificationService.mark_all_read(current_user.id)
        return jsonify({'success': True, 'affected': count})
    except Exception as exc:
        current_app.logger.error(
            f"[notifications] Error read_all(user={current_user.id}): {exc}"
        )
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Contador de no leídas (badge)
# ---------------------------------------------------------------------------

@notifications_bp.route('/unread-count', methods=['GET'])
@login_required
def unread_count():
    """Retorna el total de no leídas para el badge."""
    count = NotificationService.get_unread_count(current_user.id, is_student=False)
    return jsonify({
        'unread_count': count,
        'count': count # Legacy support for home_notifications.js
    })


# ---------------------------------------------------------------------------
# Preferencias
# ---------------------------------------------------------------------------

@notifications_bp.route('/preferences', methods=['GET', 'POST'])
@login_required
@limiter.limit("60 per minute", methods=['POST'])
def preferences():
    """
    GET  → retorna preferencias actuales del usuario.
    POST → actualiza preferencias. Body JSON esperado:
      {
        "daily_digest":  bool,
        "sound_enabled": bool,
        "email_enabled": bool,
        "muted_types":   ["comment_added", ...],
        "muted_courses": [1, 2, ...]
      }
    """
    pref = UserNotificationPreference.query.filter_by(
        user_id=current_user.id
    ).first()

    if request.method == 'GET':
        if not pref:
            return jsonify({
                'daily_digest':  True,
                'sound_enabled': False,
                'email_enabled': False,
                'muted_types':   [],
                'muted_courses': [],
                'muted_until':   None,
            })
        return jsonify({
            'daily_digest':  pref.daily_digest,
            'sound_enabled': pref.sound_enabled,
            'email_enabled': pref.email_enabled,
            'muted_types':   pref.muted_types or [],
            'muted_courses': pref.muted_courses or [],
            'muted_until':   pref.muted_until.isoformat() if pref.muted_until else None,
        })

    # POST
    data = request.get_json(silent=True) or {}
    try:
        if not pref:
            pref = UserNotificationPreference(user_id=current_user.id)
            db.session.add(pref)

        if 'daily_digest' in data:
            pref.daily_digest = bool(data['daily_digest'])
        if 'sound_enabled' in data:
            pref.sound_enabled = bool(data['sound_enabled'])
        if 'email_enabled' in data:
            pref.email_enabled = bool(data['email_enabled'])
        if 'muted_types' in data and isinstance(data['muted_types'], list):
            # Validar que son valores de NotificationType
            valid = {nt.value for nt in NotificationType}
            pref.muted_types = [t for t in data['muted_types'] if t in valid]
        if 'muted_courses' in data and isinstance(data['muted_courses'], list):
            pref.muted_courses = [int(c) for c in data['muted_courses'] if str(c).isdigit()]

        db.session.commit()
        return jsonify({'success': True})
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(
            f"[notifications] Error preferences(user={current_user.id}): {exc}"
        )
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Silenciar tipo de notificación
# ---------------------------------------------------------------------------

@notifications_bp.route('/<int:notif_id>/mute', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def mute_type(notif_id: int):
    """
    Silencia el tipo de notificación al que pertenece esta notificación.

    Body JSON: {"duration": "1h" | "24h" | "always"}
    """
    notif = Notification.query.filter_by(
        id=notif_id,
        user_id=current_user.id,
    ).first_or_404()

    data = request.get_json(silent=True) or {}
    duration = data.get('duration', '1h')

    pref = UserNotificationPreference.query.filter_by(
        user_id=current_user.id
    ).first()
    if not pref:
        pref = UserNotificationPreference(user_id=current_user.id)
        db.session.add(pref)

    try:
        if duration == 'always':
            muted = list(pref.muted_types or [])
            if notif.type.value not in muted:
                muted.append(notif.type.value)
            pref.muted_types = muted
        else:
            hours = 24 if duration == '24h' else 1
            pref.muted_until = datetime.utcnow() + timedelta(hours=hours)

        db.session.commit()
        return jsonify({'success': True, 'duration': duration})
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(
            f"[notifications] Error mute_type({notif_id}, user={current_user.id}): {exc}"
        )
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Eventos SocketIO — join/leave room personal
# ---------------------------------------------------------------------------

def register_socketio_events(sio):
    """
    Registra los eventos SocketIO del módulo de notificaciones.
    Llamar desde app.py tras socketio.init_app(app).

    El cliente se une a su room personal al conectar:
      socket.emit('notification:join')
    """

    @sio.on('notification:join')
    def on_join_notification_room():
        """Une al usuario o estudiante a su room personal."""
        from flask import session as flask_session
        from flask_login import current_user
        from flask_socketio import join_room
        
        # 1. Profe/Usuario normal (Flask-Login)
        if current_user.is_authenticated:
            room = f'user_{current_user.id}'
            join_room(room)
            current_app.logger.info(f"[SocketIO] User {current_user.id} joined notification room: {room}")
            
        # 2. Estudiante (Flask-Session)
        student_id = flask_session.get('student_id')
        if student_id:
            room = f'student_{student_id}'
            join_room(room)
            current_app.logger.info(f"[SocketIO] Student {student_id} joined notification room: {room}")

    @sio.on('notification:read')
    def on_mark_read_socket(data: dict):
        """Marca como leída vía SocketIO."""
        from flask import session as flask_session
        from flask_login import current_user
        
        notif_id = data.get('notification_id')
        if not notif_id:
            return
            
        if current_user.is_authenticated:
            NotificationService.mark_read(int(notif_id), current_user.id, is_student=False)
        else:
            student_id = flask_session.get('student_id')
            if student_id:
                NotificationService.mark_read(int(notif_id), int(student_id), is_student=True)
