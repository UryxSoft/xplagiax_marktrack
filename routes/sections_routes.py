"""
Blueprint de secciones de documentos.

Endpoints:
  GET    /api/documents/<doc_id>/sections       → listar secciones
  POST   /api/documents/<doc_id>/sections       → crear sección (solo owner)
  PATCH  /api/sections/<id>                     → actualizar título/assignee/status/progress
  DELETE /api/sections/<id>                     → eliminar sección (solo owner)

Notificación:
  SECTION_ASSIGNED → cuando se asigna o reasigna assigned_to
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, current_app
from flask_login import current_user, login_required

from models.models import (
    Document, DocumentSection, DocumentCollaborator,
    WorkspaceInvitation, NotificationType, User,
)
from services.notification_service import NotificationService
from settings.extensions import db, limiter

sections_bp = Blueprint('sections', __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_access(doc_id: int, require_owner: bool = False):
    """Retorna (document, workspace) o (None, None) si no autorizado."""
    document = Document.query.get_or_404(doc_id)
    invitation = WorkspaceInvitation.query.filter_by(document_id=doc_id).first()
    workspace = invitation.workspace if invitation else None

    if require_owner:
        if workspace and workspace.owner_id == current_user.id:
            return document, workspace
        if not workspace and document.owner_id == current_user.id:
            return document, workspace
        return None, None

    if workspace:
        is_owner   = workspace.owner_id == current_user.id
        is_student = invitation.email.lower() == current_user.email.lower()
        is_collab  = DocumentCollaborator.query.filter_by(
            document_id=doc_id, user_id=current_user.id, accepted=True
        ).first() is not None
        if is_owner or is_student or is_collab:
            return document, workspace
        return None, None

    if document.owner_id == current_user.id:
        return document, workspace
    return None, None


def _get_review_token(doc_id: int) -> str:
    try:
        from itsdangerous.url_safe import URLSafeTimedSerializer
        s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        return s.dumps({'document_id': doc_id})
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# GET: listar secciones
# ---------------------------------------------------------------------------

@sections_bp.route('/api/documents/<int:doc_id>/sections', methods=['GET'])
@login_required
def list_sections(doc_id: int):
    document, workspace = _check_access(doc_id)
    if document is None:
        return jsonify({'error': 'No autorizado'}), 403

    sections = (
        DocumentSection.query
        .filter_by(document_id=doc_id)
        .order_by(DocumentSection.order_index)
        .all()
    )
    return jsonify({'sections': [s.to_dict() for s in sections]})


# ---------------------------------------------------------------------------
# POST: crear sección
# ---------------------------------------------------------------------------

@sections_bp.route('/api/documents/<int:doc_id>/sections', methods=['POST'])
@login_required
@limiter.limit("30 per minute")
def create_section(doc_id: int):
    """
    Crea una nueva sección. Solo el profesor puede crear secciones.

    Body JSON: {"title": str, "assigned_to": int|null, "order_index": int}
    """
    document, workspace = _check_access(doc_id, require_owner=True)
    if document is None:
        return jsonify({'error': 'No autorizado. Solo el profesor puede crear secciones.'}), 403

    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'El título no puede estar vacío'}), 400

    assigned_to = data.get('assigned_to')  # puede ser None
    order_index = int(data.get('order_index', 0))

    section = DocumentSection(
        document_id=doc_id,
        title=title,
        assigned_to=assigned_to,
        order_index=order_index,
        status='in_progress',
        progress=0,
    )

    try:
        db.session.add(section)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[sections] Error creating section doc={doc_id}: {exc}")
        return jsonify({'error': 'Error interno'}), 500

    # Notificar al asignado si se proporcionó
    if assigned_to:
        _notify_section_assigned(section, document, workspace, assigned_to)

    return jsonify({'success': True, 'section': section.to_dict()}), 201


# ---------------------------------------------------------------------------
# PATCH: actualizar sección
# ---------------------------------------------------------------------------

@sections_bp.route('/api/sections/<int:section_id>', methods=['PATCH'])
@login_required
def update_section(section_id: int):
    """
    Actualiza título, assigned_to, status o progress de una sección.
    - El profesor puede cambiar cualquier campo.
    - El colaborador asignado puede actualizar status y progress.

    Body JSON (todos opcionales):
    {"title": str, "assigned_to": int|null, "status": str, "progress": int}
    """
    section  = DocumentSection.query.get_or_404(section_id)
    document, workspace = _check_access(section.document_id)
    if document is None:
        return jsonify({'error': 'No autorizado'}), 403

    # Determinar si es profesor (owner)
    is_owner = (workspace and workspace.owner_id == current_user.id) or \
               (not workspace and document.owner_id == current_user.id)
    is_assignee = section.assigned_to == current_user.id

    if not is_owner and not is_assignee:
        return jsonify({'error': 'No autorizado para editar esta sección'}), 403

    data = request.get_json(silent=True) or {}
    old_assigned = section.assigned_to

    if is_owner:
        if 'title' in data:
            title = data['title'].strip()
            if not title:
                return jsonify({'error': 'El título no puede estar vacío'}), 400
            section.title = title
        if 'assigned_to' in data:
            section.assigned_to = data['assigned_to']  # None = desasignar
        if 'order_index' in data:
            section.order_index = int(data['order_index'])

    # Ambos pueden actualizar status y progress
    if 'status' in data:
        valid_statuses = ('in_progress', 'ready', 'reviewed')
        if data['status'] in valid_statuses:
            section.status = data['status']
    if 'progress' in data:
        section.progress = max(0, min(100, int(data['progress'])))

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[sections] Error updating section={section_id}: {exc}")
        return jsonify({'error': 'Error interno'}), 500

    # SECTION_ASSIGNED: si el asignado cambió
    new_assigned = section.assigned_to
    if is_owner and new_assigned and new_assigned != old_assigned:
        _notify_section_assigned(section, document, workspace, new_assigned)

    return jsonify({'success': True, 'section': section.to_dict()})


# ---------------------------------------------------------------------------
# DELETE: eliminar sección
# ---------------------------------------------------------------------------

@sections_bp.route('/api/sections/<int:section_id>', methods=['DELETE'])
@login_required
def delete_section(section_id: int):
    section  = DocumentSection.query.get_or_404(section_id)
    document, workspace = _check_access(section.document_id, require_owner=True)
    if document is None:
        return jsonify({'error': 'No autorizado. Solo el profesor puede eliminar secciones.'}), 403

    try:
        db.session.delete(section)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[sections] Error deleting section={section_id}: {exc}")
        return jsonify({'error': 'Error interno'}), 500

    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Helper: notificación SECTION_ASSIGNED
# ---------------------------------------------------------------------------

def _notify_section_assigned(section, document, workspace, assignee_id: int):
    """Emite SECTION_ASSIGNED al colaborador asignado."""
    assignee = User.query.get(assignee_id)
    if not assignee:
        return

    assigner_name = (
        f"{current_user.name or ''} {current_user.lastname or ''}".strip()
        or current_user.email
    )
    doc_title = document.title or 'documento sin título'

    NotificationService.create(
        user_id=assignee_id,
        type=NotificationType.SECTION_ASSIGNED,
        title='You were assigned a section',
        message=f'{assigner_name} assigned the section "{section.title}" to you in "{doc_title}".',
        url=f'/review/{_get_review_token(section.document_id)}',
        priority=2,
        metadata={
            'document_id': section.document_id,
            'section_id':  section.id,
            'section_title': section.title,
        },
        course_id=workspace.id if workspace else None,
    )
