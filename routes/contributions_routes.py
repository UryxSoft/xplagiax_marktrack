"""
Blueprint de tracking de contribuciones de escritura.

Endpoints:
  POST /api/documents/<doc_id>/contributions          → registrar snapshot de contribución
  GET  /api/documents/<doc_id>/contributions/summary  → resumen por usuario (panel Activity)
"""
from __future__ import annotations

from sqlalchemy import func
from flask import Blueprint, jsonify, request, current_app
from flask_login import current_user, login_required

from models.models import (
    Document, ContributionSnapshot, WorkspaceInvitation,
    NotificationType, User
)
from services.notification_service import NotificationService
from settings.extensions import db, limiter

contributions_bp = Blueprint('contributions', __name__)

# Colores asignados por orden de aparición (hasta 8 colaboradores)
CONTRIBUTOR_COLORS = [
    '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
    '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
]


def _check_document_access(doc_id: int):
    """
    Retorna (document, invitation, workspace) si el usuario tiene acceso,
    o (None, None, None) si no está autorizado.
    """
    document = Document.query.get_or_404(doc_id)
    invitation = WorkspaceInvitation.query.filter_by(document_id=doc_id).first()
    if invitation:
        workspace = invitation.workspace
        is_owner = workspace.owner_id == current_user.id
        is_student = invitation.email.lower() == current_user.email.lower()
        if not is_owner and not is_student:
            return None, None, None
        return document, invitation, workspace
    if document.owner_id != current_user.id:
        return None, None, None
    return document, None, None


# ---------------------------------------------------------------------------
# POST: registrar snapshot de contribución
# ---------------------------------------------------------------------------

@contributions_bp.route('/api/documents/<int:doc_id>/contributions', methods=['POST'])
@login_required
@limiter.limit("60 per minute")
def record_contribution(doc_id: int):
    """
    Registra un snapshot de contribución del usuario actual.

    Body JSON:
    {
        "action":           "insert" | "delete" | "format",
        "content":          str,   // texto insertado/eliminado (truncado a 500)
        "position_from":    int,
        "position_to":      int,
        "word_count_delta": int    // positivo=inserción, negativo=eliminación
    }
    """
    document, invitation, workspace = _check_document_access(doc_id)
    if document is None:
        return jsonify({'error': 'No autorizado'}), 403

    data = request.get_json(silent=True) or {}
    action = data.get('action', 'insert')
    if action not in ('insert', 'delete', 'format'):
        action = 'insert'

    content          = str(data.get('content') or '')[:500]
    position_from    = data.get('position_from')
    position_to      = data.get('position_to')
    word_count_delta = int(data.get('word_count_delta', 0))

    snapshot = ContributionSnapshot(
        document_id=doc_id,
        user_id=current_user.id,
        action=action,
        content=content,
        position_from=position_from,
        position_to=position_to,
        word_count_delta=word_count_delta,
    )
    try:
        db.session.add(snapshot)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[contributions] Error saving snapshot doc={doc_id}: {exc}")
        return jsonify({'error': 'Error interno'}), 500

    # ── Notificación SECTION_EDITED al profesor (umbral: 10 palabras, cooldown: 10 min) ──
    if word_count_delta >= 10 and invitation:
        is_student = invitation.email.lower() == current_user.email.lower()
        if is_student:
            student_name = (
                f"{current_user.name or ''} {current_user.lastname or ''}".strip()
                or current_user.email
            )
            _notify_section_edited(
                workspace_owner_id=workspace.owner_id,
                student_name=student_name,
                word_count_delta=word_count_delta,
                doc_id=doc_id,
                workspace=workspace,
            )

    return jsonify({'success': True}), 201


def _notify_section_edited(workspace_owner_id, student_name, word_count_delta, doc_id, workspace):
    """Emite SECTION_EDITED al profesor con cooldown de 10 minutos vía Redis."""
    from settings.extensions import redis_client
    cooldown_key = f'notif:section_edited:{workspace_owner_id}:{doc_id}'
    try:
        if redis_client and redis_client.get(cooldown_key):
            return
        if redis_client:
            redis_client.setex(cooldown_key, 600, '1')
    except Exception:
        pass  # Redis no disponible — notificar de todas formas

    NotificationService.create(
        user_id=workspace_owner_id,
        type=NotificationType.SECTION_EDITED,
        title='The student is actively editing',
        message=f'{student_name} added ~{word_count_delta} words to the document.',
        url=f'/review/{_get_review_token(doc_id)}',
        priority=3,
        metadata={'document_id': doc_id, 'word_count_delta': word_count_delta},
        course_id=workspace.id,
    )


def _get_review_token(doc_id: int) -> str:
    try:
        from flask import current_app
        from itsdangerous.url_safe import URLSafeTimedSerializer
        s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        return s.dumps({'document_id': doc_id})
    except Exception:
        return ''


# ---------------------------------------------------------------------------
# GET: resumen de contribuciones por usuario (para el panel Activity)
# ---------------------------------------------------------------------------

@contributions_bp.route('/api/documents/<int:doc_id>/contributions/summary', methods=['GET'])
@login_required
def get_contributions_summary(doc_id: int):
    """
    Retorna resumen de contribuciones agrupado por usuario.
    Accesible para el profesor y el estudiante asignado.
    """
    document, invitation, workspace = _check_document_access(doc_id)
    if document is None:
        return jsonify({'error': 'No autorizado'}), 403

    rows = (
        db.session.query(
            ContributionSnapshot.user_id,
            func.sum(
                db.case(
                    (ContributionSnapshot.word_count_delta > 0, ContributionSnapshot.word_count_delta),
                    else_=0
                )
            ).label('words_added'),
            func.sum(
                db.case(
                    (ContributionSnapshot.word_count_delta < 0, ContributionSnapshot.word_count_delta),
                    else_=0
                )
            ).label('words_removed'),
            func.max(ContributionSnapshot.created_at).label('last_active'),
        )
        .filter(ContributionSnapshot.document_id == doc_id)
        .group_by(ContributionSnapshot.user_id)
        .all()
    )

    total_words_added = sum(max(int(r.words_added or 0), 0) for r in rows)

    contributors = []
    for i, row in enumerate(rows):
        user = User.query.get(row.user_id)
        if not user:
            continue
        words_added   = int(row.words_added or 0)
        words_removed = abs(int(row.words_removed or 0))
        net_words     = words_added - words_removed
        percentage    = round(
            (words_added / total_words_added * 100) if total_words_added > 0 else 0, 1
        )
        contributors.append({
            'user_id':       row.user_id,
            'user_name':     f"{user.name or ''} {user.lastname or ''}".strip() or user.email,
            'words_added':   words_added,
            'words_removed': words_removed,
            'net_words':     net_words,
            'percentage':    percentage,
            'color':         CONTRIBUTOR_COLORS[i % len(CONTRIBUTOR_COLORS)],
            'last_active':   row.last_active.isoformat() if row.last_active else None,
        })

    contributors.sort(key=lambda x: x['words_added'], reverse=True)

    last_snapshot = (
        ContributionSnapshot.query
        .filter_by(document_id=doc_id)
        .order_by(ContributionSnapshot.created_at.desc())
        .first()
    )

    return jsonify({
        'contributors':      contributors,
        'total_words_added': total_words_added,
        'last_updated':      last_snapshot.created_at.isoformat() if last_snapshot else None,
    })
