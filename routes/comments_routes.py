"""
Blueprint de comentarios inline del profesor sobre documentos.

Endpoints:
  GET  /api/documents/<doc_id>/comments          → lista de comentarios del documento
  POST /api/documents/<doc_id>/comments          → crear comentario (solo profesor/owner del workspace)
  POST /api/comments/<comment_id>/resolve        → resolver comentario (cualquier colaborador)
  DELETE /api/comments/<comment_id>              → eliminar comentario (solo autor)

Seguridad:
  - Todos requieren @login_required.
  - GET: verifica que current_user es dueño del workspace O es el estudiante del documento.
  - POST: verifica que current_user es dueño del workspace (rol profesor).
  - DELETE: verifica que current_user es el autor del comentario.
"""

from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request, current_app
from flask_login import current_user, login_required

from models.models import (
    Document, DocumentComment, WorkspaceInvitation,
    NotificationType, User
)
from services.notification_service import NotificationService
from settings.extensions import db, limiter

comments_bp = Blueprint('comments', __name__)


def _get_document_and_check_access(doc_id: int, require_owner: bool = False):
    """
    Carga el documento y verifica acceso.
    Soporta tanto User (Profesor) como Student (Sesión).
    """
    from flask import session as flask_session
    document = Document.query.get_or_404(doc_id)
    invitation = WorkspaceInvitation.query.filter_by(document_id=doc_id).first()

    student_id = flask_session.get('student_id')

    if invitation:
        workspace = invitation.workspace
        is_owner = current_user.is_authenticated and workspace.owner_id == current_user.id
        is_student = student_id is not None or (current_user.is_authenticated and invitation.email.lower() == current_user.email.lower())

        if require_owner and not is_owner:
            return None, None, None
        if not is_owner and not is_student:
            return None, None, None
        return document, invitation, workspace

    # Documento sin workspace: solo el dueño puede acceder
    if not current_user.is_authenticated or document.owner_id != current_user.id:
        return None, None, None
    return document, None, None


# ---------------------------------------------------------------------------
# GET: listar comentarios
# ---------------------------------------------------------------------------

@comments_bp.route('/api/documents/<int:doc_id>/comments', methods=['GET'])
@login_required
def list_comments(doc_id: int):
    """
    Retorna todos los comentarios del documento ordenados por posición.
    Accesible para el profesor y el estudiante asignado.
    """
    document, invitation, workspace = _get_document_and_check_access(doc_id)
    if document is None:
        return jsonify({'error': 'Unauthorized'}), 403

    comments = (
        DocumentComment.query
        .filter_by(document_id=doc_id, parent_id=None)
        .order_by(DocumentComment.created_at.asc())
        .all()
    )

    result = []
    for c in comments:
        c_dict = c.to_dict()
        # Agregar replies
        c_dict['replies'] = [r.to_dict() for r in c.replies.order_by(DocumentComment.created_at.asc()).all()]
        result.append(c_dict)

    return jsonify({'comments': result, 'total': len(result)})


# ---------------------------------------------------------------------------
# POST: crear comentario
# ---------------------------------------------------------------------------

@comments_bp.route('/api/documents/<int:doc_id>/comments', methods=['POST'])
@limiter.limit("30 per minute")
def create_comment(doc_id: int):
    """
    Crea un comentario inline. Solo el profesor (dueño del workspace) puede crear.

    Body JSON:
    {
        "text":           str,
        "selection_from": int,   // índice inicio en Quill delta
        "selection_to":   int,   // índice fin en Quill delta
        "color":          str,   // hex, ej: "#FDE68A"
        "parent_id":      int | null  // para respuestas
    }
    """
    # Allows both professor and student to comment
    document, invitation, workspace = _get_document_and_check_access(doc_id, require_owner=False)
    if document is None:
        return jsonify({'error': 'Unauthorized. You do not have permission to comment on this document.'}), 403

    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment cannot be empty'}), 400

    selection_from = data.get('selection_from')
    selection_to   = data.get('selection_to')
    page_index     = data.get('page_index')
    color          = data.get('color', '#FDE68A')
    parent_id      = data.get('parent_id')

    # Validar color hex
    import re
    if not re.match(r'^#[0-9A-Fa-f]{6}$', str(color)):
        color = '#FDE68A'

    comment = DocumentComment(
        document_id=doc_id,
        author_id=current_user.id,
        text=text,
        selection_from=selection_from,
        selection_to=selection_to,
        page_index=page_index,
        color=color,
        parent_id=parent_id,
    )

    try:
        db.session.add(comment)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[comments] Error al crear comentario doc={doc_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    # ── Disparar notificación ──────────────────────────────
    if invitation:
        from models.models import StudentWorkspaceUser, User
        from flask import session as flask_session
        
        student_id = flask_session.get('student_id')
        author_name = ""
        if current_user.is_authenticated:
            author_name = f"{current_user.name or ''} {current_user.lastname or ''}".strip() or current_user.email
        else:
            stu = StudentWorkspaceUser.query.get(student_id) if student_id else None
            author_name = stu.full_name if stu else "Student"

        # Case 1: Professor adds a comment → Notify Student
        if current_user.is_authenticated and workspace and current_user.id == workspace.owner_id:
            student_record = StudentWorkspaceUser.query.filter_by(email=invitation.email.lower()).first()
            if student_record:
                NotificationService.create(
                    student_id=student_record.id,
                    type=NotificationType.COMMENT_ADDED,
                    title="The professor added a comment",
                    message=f'{author_name}: "{text[:80] + ("..." if len(text) > 80 else "")}"',
                    url=f"/invite/{invitation.token}",
                    priority=2,
                    metadata={'document_id': doc_id, 'comment_id': comment.id},
                    course_id=workspace.id,
                )
        
        # Case 2: Student adds a comment → Notify Professor
        elif student_id or (current_user.is_authenticated and invitation.email.lower() == current_user.email.lower()):
            NotificationService.create(
                user_id=workspace.owner_id,
                type=NotificationType.COMMENT_ADDED,
                title="Student added a comment",
                message=f'{author_name}: "{text[:80] + ("..." if len(text) > 80 else "")}"',
                url=f"/review/{_get_review_token(document)}",
                priority=2,
                metadata={'document_id': doc_id, 'comment_id': comment.id},
                course_id=workspace.id,
            )

    # ── Disparar notificaciones MENTION ──────────────────────────────────
    mention_emails = data.get('mentions', [])
    if mention_emails and isinstance(mention_emails, list):
        author_name = f"{current_user.name or ''} {current_user.lastname or ''}".strip() or current_user.email
        mention_url = f"/invite/{invitation.token}" if invitation else f"/review/{_get_review_token(document)}"
        for email in mention_emails[:5]:
            if not isinstance(email, str):
                continue
            email = email.strip().lower()
            if not email:
                continue
            mentioned_user = User.query.filter_by(email=email).first()
            if mentioned_user and mentioned_user.id != current_user.id:
                NotificationService.create(
                    user_id=mentioned_user.id,
                    type=NotificationType.MENTION,
                    title='You were mentioned in a comment',
                    message=f'{author_name} mentioned you: "{text[:80] + ("..." if len(text) > 80 else "")}"',
                    url=mention_url,
                    priority=2,
                    metadata={
                        'document_id': doc_id,
                        'comment_id':  comment.id,
                    },
                    course_id=workspace.id if workspace else None,
                )

    return jsonify({'success': True, 'comment': comment.to_dict()}), 201


# ---------------------------------------------------------------------------
# POST: reply a un comentario
# ---------------------------------------------------------------------------

@comments_bp.route('/api/comments/<int:comment_id>/reply', methods=['POST'])
@login_required
@limiter.limit("30 per minute")
def reply_comment(comment_id: int):
    """
    Agrega una respuesta a un comentario existente.
    Accesible para el profesor y el estudiante.

    Body JSON: {"text": str}
    """
    parent = DocumentComment.query.get_or_404(comment_id)
    document, invitation, workspace = _get_document_and_check_access(parent.document_id)
    if document is None:
        return jsonify({'error': 'Unauthorized'}), 403

    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Reply cannot be empty'}), 400

    reply = DocumentComment(
        document_id=parent.document_id,
        author_id=current_user.id,
        text=text,
        parent_id=comment_id,
        color=parent.color,
    )

    try:
        db.session.add(reply)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[comments] Error al crear reply comment={comment_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    # Notificar al autor del comentario padre (si es diferente del que responde)
    if parent.author_id != current_user.id:
        responder_name = f"{current_user.name or ''} {current_user.lastname or ''}".strip() or current_user.email
        NotificationService.create(
            user_id=parent.author_id,
            type=NotificationType.COMMENT_REPLIED,
            title="New reply to your comment",
            message=f'{responder_name}: "{text[:80] + ("..." if len(text) > 80 else "")}"',
            url=f"/review/{_get_review_token(document)}",
            priority=2,
            metadata={'document_id': parent.document_id, 'comment_id': parent.id},
        )

    return jsonify({'success': True, 'reply': reply.to_dict()}), 201


def _get_review_token(document) -> str:
    """Genera un token de review para el documento (para deep-links en notificaciones)."""
    try:
        from flask import current_app
        from itsdangerous.url_safe import URLSafeTimedSerializer
        s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        return s.dumps({'document_id': document.id})
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# POST: resolver comentario
# ---------------------------------------------------------------------------

@comments_bp.route('/api/comments/<int:comment_id>/resolve', methods=['POST'])
@limiter.limit("30 per minute")
def resolve_comment(comment_id: int):
    """
    Marca un comentario como resuelto.
    El estudiante lo resuelve → notifica al profesor.
    """
    comment = DocumentComment.query.get_or_404(comment_id)
    document, invitation, workspace = _get_document_and_check_access(comment.document_id)
    if document is None:
        return jsonify({'error': 'Unauthorized'}), 403

    if comment.resolved:
        return jsonify({'success': True, 'already_resolved': True})

    try:
        comment.resolved    = True
        comment.resolved_by = current_user.id
        comment.resolved_at = datetime.utcnow()
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[comments] Error al resolver comment={comment_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    # Notificar al autor del comentario (o al profesor)
    from flask import session as flask_session
    student_id = flask_session.get('student_id')
    
    # If a student resolves it → Notify Professor
    if student_id or (not current_user.is_authenticated):
        from models.models import StudentWorkspaceUser
        stu = StudentWorkspaceUser.query.get(student_id) if student_id else None
        resolver_name = stu.full_name if stu else "Student"
        
        NotificationService.create(
            user_id=workspace.owner_id,
            type=NotificationType.COMMENT_RESOLVED,
            title="Comment marked as resolved",
            message=f'{resolver_name} resolved a comment: "{comment.text[:60] + ("..." if len(comment.text) > 60 else "")}"',
            url=f"/review/{_get_review_token(document)}",
            priority=3,
            metadata={'document_id': comment.document_id, 'comment_id': comment_id},
            course_id=workspace.id,
        )
    # If professor resolves it → Notify Student
    elif current_user.id == workspace.owner_id:
        student_record = StudentWorkspaceUser.query.filter_by(email=invitation.email.lower()).first()
        if student_record:
            NotificationService.create(
                student_id=student_record.id,
                type=NotificationType.COMMENT_RESOLVED,
                title="Professor resolved your comment",
                message=f'Your comment was marked as resolved: "{comment.text[:60] + ("..." if len(comment.text) > 60 else "")}"',
                url=f"/invite/{invitation.token}",
                priority=3,
                metadata={'document_id': comment.document_id, 'comment_id': comment_id},
                course_id=workspace.id,
            )

    return jsonify({'success': True, 'comment': comment.to_dict()})


# ---------------------------------------------------------------------------
# PATCH: actualizar comentario
# ---------------------------------------------------------------------------

@comments_bp.route('/api/comments/<int:comment_id>', methods=['PATCH'])
@login_required
@limiter.limit("30 per minute")
def update_comment(comment_id: int):
    """
    Actualiza el texto de un comentario. Solo el autor del comentario puede editarlo.
    """
    comment = DocumentComment.query.get_or_404(comment_id)

    if comment.author_id != current_user.id:
        return jsonify({'error': 'Only the author can edit this comment'}), 403

    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'Comment cannot be empty'}), 400

    try:
        comment.text = text
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[comments] Error al actualizar comment={comment_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    return jsonify({'success': True, 'comment': comment.to_dict()})


# ---------------------------------------------------------------------------
# DELETE: eliminar comentario
# ---------------------------------------------------------------------------

@comments_bp.route('/api/comments/<int:comment_id>', methods=['DELETE'])
@login_required
@limiter.limit("30 per minute")
def delete_comment(comment_id: int):
    """
    Elimina un comentario. Solo el autor del comentario puede eliminarlo.
    """
    comment = DocumentComment.query.get_or_404(comment_id)

    if comment.author_id != current_user.id:
        return jsonify({'error': 'Only the author can delete this comment'}), 403

    try:
        db.session.delete(comment)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[comments] Error al eliminar comment={comment_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    return jsonify({'success': True})
