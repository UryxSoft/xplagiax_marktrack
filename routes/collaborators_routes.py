"""
Blueprint de colaboradores de documentos.

Endpoints:
  GET    /api/documents/<doc_id>/collaborators          → listar colaboradores
  POST   /api/documents/<doc_id>/collaborators/invite   → invitar por email
  POST   /api/collaborators/<id>/accept                 → aceptar invitación
  DELETE /api/collaborators/<id>                        → remover colaborador

SocketIO:
  doc:join  → une al usuario a la sala doc_{doc_id}, emite doc:user_joined
  doc:leave → sale de la sala, emite doc:user_left
  doc:cursor → retransmite posición de cursor al resto de la sala
"""
from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request, current_app, redirect, url_for, render_template, session, flash
from flask_login import current_user, login_required
from flask_mail import Message
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

from models.models import (
    Document, DocumentCollaborator, WorkspaceInvitation,
    NotificationType, User,
)
from services.notification_service import NotificationService
from settings.extensions import db, limiter, mail

collaborators_bp = Blueprint('collaborators', __name__)

# Collaborative editing limits
MAX_COLLABORATORS = 3   # Maximum collaborators per document (excluding owner)
MIN_COLLABORATORS_FOR_COLLAB = 2  # Min accepted collaborators to enable real-time collab

# ── Token Security (24h expiry) ───────────────────────────────────────────

def _get_serializer():
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

def generate_collab_token(collab_id: int) -> str:
    s = _get_serializer()
    return s.dumps(collab_id, salt='collab-invite')

def verify_collab_token(token: str, expiration: int = 86400) -> int | None:
    """Verifica el token y devuelve collab_id si es válido y no ha expirado."""
    s = _get_serializer()
    try:
        collab_id = s.loads(token, salt='collab-invite', max_age=expiration)
        return collab_id
    except (SignatureExpired, BadSignature):
        return None


# ---------------------------------------------------------------------------
# Helpers de autorización
# ---------------------------------------------------------------------------

def _check_access(doc_id: int, require_owner: bool = False):
    """
    Retorna (document, workspace) o (None, None) si no autorizado.
    require_owner=True → solo el dueño del workspace puede acceder.
    """
    document = Document.query.get_or_404(doc_id)
    invitation = WorkspaceInvitation.query.filter_by(document_id=doc_id).first()
    workspace = invitation.workspace if invitation else None

    if require_owner:
        if workspace and workspace.owner_id == current_user.id:
            return document, workspace
        if not workspace and document.owner_id == current_user.id:
            return document, workspace
        return None, None

    # Acceso general: owner, estudiante asignado o colaborador aceptado
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
# GET: listar colaboradores
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/documents/<int:doc_id>/collaborators', methods=['GET'])
@login_required
def list_collaborators(doc_id: int):
    document, workspace = _check_access(doc_id)
    if document is None:
        return jsonify({'error': 'Unauthorized'}), 403

    collabs = DocumentCollaborator.query.filter_by(document_id=doc_id).all()
    active_count = sum(1 for c in collabs if c.accepted)
    collab_mode_enabled = active_count >= MIN_COLLABORATORS_FOR_COLLAB
    return jsonify({
        'collaborators': [c.to_dict() for c in collabs],
        'limits': {
            'min': MIN_COLLABORATORS_FOR_COLLAB,
            'max': MAX_COLLABORATORS,
            'current': len(collabs),
            'active': active_count,
        },
        'collab_mode_enabled': collab_mode_enabled,
    })


# ---------------------------------------------------------------------------
# GET: collab-status (lightweight check for frontend)
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/documents/<int:doc_id>/collab-status', methods=['GET'])
@login_required
def get_collab_status(doc_id: int):
    """
    Returns whether collaborative editing mode is active for a document.
    Active = at least MIN_COLLABORATORS_FOR_COLLAB collaborators have accepted.
    """
    document, workspace = _check_access(doc_id)
    if document is None:
        return jsonify({'error': 'Unauthorized'}), 403

    collabs = DocumentCollaborator.query.filter_by(document_id=doc_id).all()
    active_count = sum(1 for c in collabs if c.accepted)
    collab_mode_enabled = active_count >= MIN_COLLABORATORS_FOR_COLLAB

    return jsonify({
        'collab_mode_enabled': collab_mode_enabled,
        'active_collaborators': active_count,
        'total_collaborators': len(collabs),
        'min_required': MIN_COLLABORATORS_FOR_COLLAB,
        'max_allowed': MAX_COLLABORATORS,
    })


# ---------------------------------------------------------------------------
# POST: invitar colaborador por email
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/documents/<int:doc_id>/collaborators/invite', methods=['POST'])
@login_required
@limiter.limit("20 per minute")
def invite_collaborator(doc_id: int):
    """
    Invita a un usuario registrado por email.
    Solo el profesor (workspace owner) puede invitar.

    Body JSON: {"email": str, "role": "editor"|"collaborator"|"reader"}
    """
    document, workspace = _check_access(doc_id, require_owner=True)
    if document is None:
        return jsonify({'error': 'Unauthorized. Only the professor can invite.'}), 403

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    role  = data.get('role', 'collaborator')
    if role not in ('editor', 'collaborator', 'reader'):
        role = 'collaborator'

    if not email or '@' not in email:
        return jsonify({'error': 'Invalid email'}), 400

    # ── Enforce MAX_COLLABORATORS limit ──────────────────────────────────────
    current_count = DocumentCollaborator.query.filter_by(document_id=doc_id).count()
    if current_count >= MAX_COLLABORATORS:
        return jsonify({
            'error': f'Maximum of {MAX_COLLABORATORS} collaborators reached for this document'
        }), 409

    invitee = User.query.filter_by(email=email).first()
    if not invitee:
        return jsonify({'error': 'No account registered with that email exists'}), 404

    existing = DocumentCollaborator.query.filter_by(
        document_id=doc_id, user_id=invitee.id
    ).first()
    if existing:
        return jsonify({'error': 'This user is already a collaborator on the document'}), 409

    collab = DocumentCollaborator(
        document_id=doc_id,
        user_id=invitee.id,
        role=role,
        invited_by=current_user.id,
        accepted=False,
    )

    try:
        db.session.add(collab)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[collaborators] Error inviting user doc={doc_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    inviter_name = (
        f"{current_user.name or ''} {current_user.lastname or ''}".strip()
        or current_user.email
    )
    doc_title = document.title or 'untitled document'

    # Notificación in-app COLLABORATION_INVITE
    NotificationService.create(
        user_id=invitee.id,
        type=NotificationType.COLLABORATION_INVITE,
        title='You have been invited to collaborate',
        message=f'{inviter_name} invited you to collaborate on "{doc_title}".',
        url=f'/api/collaborators/{collab.id}/accept',
        priority=2,
        metadata={
            'document_id':    doc_id,
            'collaborator_id': collab.id,
            'role':           role,
        },
        course_id=workspace.id if workspace else None,
    )

    # Email de invitación
    _send_invite_email(
        to_email=email,
        to_name=f"{invitee.name or ''} {invitee.lastname or ''}".strip() or email,
        inviter_name=inviter_name,
        doc_title=doc_title,
        collab_id=collab.id,
    )

    return jsonify({'success': True, 'collaborator': collab.to_dict()}), 201


# ---------------------------------------------------------------------------
# POST: aceptar invitación
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/collaborators/<int:collab_id>/accept', methods=['POST'])
@login_required
def accept_invitation(collab_id: int):
    """Acepta una invitación (vía POST desde la UI)."""
    collab = DocumentCollaborator.query.get_or_404(collab_id)
    return _process_acceptance(collab)

@collaborators_bp.route('/api/collaborators/register/<string:token>', methods=['POST'])
def register_collaborator_via_token(token: str):
    """Register a collaborator student: name + password → StudentWorkspaceUser + session"""
    from models.models import StudentWorkspaceUser, DocumentCollaborator
    from flask import session as flask_session
    import re

    collab_id = verify_collab_token(token)
    if not collab_id:
        return jsonify({'success': False, 'error': 'Invalid or expired link'}), 404

    collab = DocumentCollaborator.query.get(collab_id)
    if not collab:
        return jsonify({'success': False, 'error': 'Collaboration not found'}), 404

    if collab.accepted:
        return jsonify({'success': True, 'redirect': '/homework', 'message': 'Already accepted'})

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    first_name = (data.get('first_name') or '').strip()
    last_name  = (data.get('last_name')  or '').strip()
    password   = data.get('password', '')
    password_confirm = data.get('password_confirm', password)

    if not first_name or not last_name:
        return jsonify({'success': False, 'error': 'First name and last name are required'}), 400

    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400
    if password != password_confirm:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400

    try:
        # 1. Create Student account if not exists
        student = StudentWorkspaceUser.query.filter_by(email=collab.user.email).first()
        if not student:
            student = StudentWorkspaceUser(
                email=collab.user.email,
                first_name=first_name,
                last_name=last_name,
                is_active=True
            )
            student.set_password(password)
            db.session.add(student)
            db.session.flush()
        
        # 2. Link collaborator to user
        collab.user_id = student.id
        _process_acceptance(collab)
        
        db.session.commit()

        # 3. Initialize Student session
        flask_session.permanent = True
        flask_session['student_id']    = student.id
        flask_session['student_email'] = student.email
        flask_session['student_name']  = student.full_name

        return jsonify({
            'success': True, 
            'redirect': '/homework',
            'message': 'Account created and invitation accepted!'
        })
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[collaborators] Error registering collab={collab_id}: {exc}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500

@collaborators_bp.route('/api/collaborators/accept/<string:token>', methods=['GET'])
def accept_invitation_via_token(token: str):
    """Acepta una invitación vía link de email (GET) con token de 24h."""
    collab_id = verify_collab_token(token)
    if not collab_id:
        return render_template('error.html', 
            message='The invitation link is invalid or has expired (24h limit).',
            title='Expired Invitation'), 400

    collab = DocumentCollaborator.query.get_or_404(collab_id)
    
    # La autenticación se maneja ahora en la pantalla /homework vía collab_token
    is_student = session.get('student_id') is not None
    is_user    = current_user.is_authenticated

    if not is_student and not is_user:
        return redirect(url_for('student.homework', collab_token=token))

    # Verificar si el colaborador ya está asignado a alguien más
    if collab.user_id:
        curr_id = session.get('student_id') or (current_user.id if is_user else None)
        if collab.user_id != curr_id:
             return render_template('error.html', 
                message='This invitation has already been claimed or belongs to another user.',
                title='Unauthorized'), 403

    _process_acceptance(collab)
    
    # Redirigir al destino apropiado
    flash('Invitation accepted! You are now a collaborator.', 'success')
    if is_student:
        return redirect(url_for('student.homework'))
    return redirect(f'/invite?token={collab.document_id}')

def _process_acceptance(collab):
    """Lógica común para marcar como aceptado."""
    if collab.accepted:
        return jsonify({'success': True, 'already_accepted': True}) if request.is_json else None

    try:
        collab.accepted    = True
        collab.accepted_at = datetime.utcnow()
        db.session.commit()
        
        # Notificar al invitador de que aceptó
        acceptor_name = (
            f"{current_user.name or ''} {current_user.lastname or ''}".strip()
            or current_user.email
        )
        if collab.invited_by:
            from services.notification_service import NotificationService
            NotificationService.create(
                user_id=collab.invited_by,
                type=NotificationType.COLLABORATION_INVITE,
                title='Invitation accepted',
                message=f'{acceptor_name} accepted your invitation to collaborate.',
                url=f'/review/{_get_review_token(collab.document_id)}',
                priority=3,
                metadata={'document_id': collab.document_id, 'collaborator_id': collab.id},
            )

        # Verificar si todos aceptaron → TEAM_FORMED
        _check_and_notify_team_formed(collab.document_id)
        
        if request.is_json:
            return jsonify({'success': True, 'collaborator': collab.to_dict()})
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[collaborators] Error accepting collab={collab.id}: {exc}")
        if request.is_json:
            return jsonify({'error': 'Internal error'}), 500
    
    return None


# ---------------------------------------------------------------------------
# PATCH: cambiar rol de un colaborador
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/collaborators/<int:collab_id>/role', methods=['PATCH'])
@login_required
def update_role(collab_id: int):
    """
    Cambia el rol de un colaborador.
    Solo el profesor (workspace owner) puede cambiar roles.

    Body JSON: {"role": "editor"|"collaborator"|"reader"}
    """
    collab = DocumentCollaborator.query.get_or_404(collab_id)
    document, workspace = _check_access(collab.document_id, require_owner=True)
    if document is None:
        return jsonify({'error': 'Unauthorized. Only the professor can change roles.'}), 403

    data = request.get_json(silent=True) or {}
    new_role = data.get('role', '')
    if new_role not in ('editor', 'collaborator', 'reader'):
        return jsonify({'error': 'Invalid role. Values: editor, collaborator, reader'}), 400

    try:
        collab.role = new_role
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[collaborators] Error updating role collab={collab_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    return jsonify({'success': True, 'collaborator': collab.to_dict()})


# ---------------------------------------------------------------------------
# DELETE: remover colaborador
# ---------------------------------------------------------------------------

@collaborators_bp.route('/api/collaborators/<int:collab_id>', methods=['DELETE'])
@login_required
def remove_collaborator(collab_id: int):
    collab = DocumentCollaborator.query.get_or_404(collab_id)

    # Puede eliminar: el dueño del workspace O el propio colaborador (salir)
    document, workspace = _check_access(collab.document_id, require_owner=True)
    if document is None and collab.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403

    try:
        db.session.delete(collab)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error(f"[collaborators] Error removing collab={collab_id}: {exc}")
        return jsonify({'error': 'Internal error'}), 500

    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _check_and_notify_team_formed(doc_id: int):
    """Emite TEAM_FORMED a todos si todos los colaboradores ya aceptaron."""
    collabs = DocumentCollaborator.query.filter_by(document_id=doc_id).all()
    if not collabs or not all(c.accepted for c in collabs):
        return

    document  = Document.query.get(doc_id)
    doc_title = document.title if document else 'the document'
    collab_ids = {c.user_id for c in collabs}

    for collab in collabs:
        NotificationService.create(
            user_id=collab.user_id,
            type=NotificationType.TEAM_FORMED,
            title='The team is complete!',
            message=f'All collaborators have accepted on "{doc_title}".',
            url=f'/review/{_get_review_token(doc_id)}',
            priority=2,
            metadata={'document_id': doc_id},
        )

    # Notificar también al invitador si no es colaborador
    invited_bys = {c.invited_by for c in collabs if c.invited_by}
    for inviter_id in invited_bys - collab_ids:
        NotificationService.create(
            user_id=inviter_id,
            type=NotificationType.TEAM_FORMED,
            title='The team is complete!',
            message=f'All members are ready on "{doc_title}".',
            url=f'/review/{_get_review_token(doc_id)}',
            priority=2,
            metadata={'document_id': doc_id},
        )


def _send_invite_email(to_email: str, to_name: str, inviter_name: str,
                       doc_title: str, collab_id: int):
    """Envía email HTML de invitación con token de seguridad."""
    try:
        token = generate_collab_token(collab_id)
        base_url = current_app.config.get('APP_BASE_URL', 'http://localhost:5000')
        accept_url = f"{base_url}/homework?collab_token={token}"
        subject   = f'{inviter_name} te invitó a colaborar — MarkTrack'
        html_body = f"""<!DOCTYPE html>
<html><body style="font-family:Inter,sans-serif;background:#f9fafb;padding:40px 0;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="#6366f1" viewBox="0 0 16 16">
      <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
      <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
    </svg>
    <span style="font-size:20px;font-weight:700;color:#1e293b;">MarkTrack</span>
  </div>
  <h2 style="color:#1e293b;margin:0 0 8px;">You have been invited to collaborate</h2>
  <p style="color:#64748b;line-height:1.6;margin-bottom:24px;">
    Hello {to_name},<br><br>
    <strong>{inviter_name}</strong> has invited you to collaborate on the document
    <strong>&ldquo;{doc_title}&rdquo;</strong>.
  </p>
  <a href="{accept_url}"
     style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;
            border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
    Accept invitation
  </a>
  <p style="color:#94a3b8;font-size:12px;margin-top:28px;line-height:1.5;">
    If you were not expecting this invitation, you can safely ignore this email.<br>
    Message automatically generated by MarkTrack.
  </p>
</div>
</body></html>"""
        msg = Message(subject=subject, recipients=[to_email], html=html_body)
        mail.send(msg)
    except Exception as exc:
        current_app.logger.warning(f"[collaborators] Email not sent to {to_email}: {exc}")


# ---------------------------------------------------------------------------
# SocketIO: presencia en sala de documento
# ---------------------------------------------------------------------------

def register_doc_socketio_events(sio):
    """
    Registra eventos SocketIO para la sala doc_{doc_id}.
    Llamar desde app.py tras register_socketio_events().

    Eventos del cliente → servidor:
      doc:join            {doc_id}                 → une al usuario, emite doc:user_joined al resto
      doc:leave           {doc_id}                 → sale, emite doc:user_left al resto
      doc:cursor          {doc_id, index, length}  → retransmite posición de cursor
      yjs:update          {doc_id, update}         → broadcast Yjs update binario (base64)
      yjs:sync_request    {doc_id}                 → devuelve state completo al solicitante
      yjs:awareness       {doc_id, awareness}      → broadcast awareness state

    Eventos servidor → sala:
      doc:user_joined     {user_id, user_name, initials, doc_id}
      doc:user_left       {user_id, doc_id}
      doc:cursor_moved    {user_id, index, length}
      yjs:update          {update}                → broadcast al resto de peers
      yjs:sync            {state, doc_id}         → estado completo para el nuevo peer
      yjs:awareness       {awareness}             → awareness broadcast
    """

    @sio.on('doc:join')
    def on_doc_join(data: dict):
        from flask_login import current_user
        from flask_socketio import join_room
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        if not doc_id:
            return
        room = f'doc_{doc_id}'
        join_room(room)
        user_name = (
            f"{current_user.name or ''} {current_user.lastname or ''}".strip()
            or current_user.email
        )
        parts    = user_name.split()
        initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else '')).upper()
        sio.emit('doc:user_joined', {
            'user_id':   current_user.id,
            'user_name': user_name,
            'initials':  initials,
            'doc_id':    doc_id,
        }, room=room, skip_sid=True)

        # Send current Yjs state to the new peer (emit back to caller only)
        try:
            from flask_socketio import emit as sio_emit
            from services.yjs_state_service import YjsStateService
            state = YjsStateService.get_state(doc_id)
            if state:
                sio_emit('yjs:sync', {
                    'state':  state,
                    'doc_id': doc_id,
                })
        except Exception as exc:
            current_app.logger.debug(f'[yjs] Could not send initial state to peer: {exc}')

    @sio.on('doc:leave')
    def on_doc_leave(data: dict):
        from flask_login import current_user
        from flask_socketio import leave_room
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        if not doc_id:
            return
        room = f'doc_{doc_id}'
        leave_room(room)
        sio.emit('doc:user_left', {
            'user_id': current_user.id,
            'doc_id':  doc_id,
        }, room=room)

    @sio.on('doc:cursor')
    def on_doc_cursor(data: dict):
        from flask_login import current_user
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        if not doc_id:
            return
        sio.emit('doc:cursor_moved', {
            'user_id': current_user.id,
            'index':   data.get('index', 0),
            'length':  data.get('length', 0),
        }, room=f'doc_{doc_id}', skip_sid=True)

    # ── Yjs CRDT Sync Events ────────────────────────────────────────────────

    @sio.on('yjs:update')
    def on_yjs_update(data: dict):
        """
        Recibe un Yjs update binario (base64) y lo retransmite a todos
        los peers en la sala. También actualiza el cache Redis.
        """
        from flask_login import current_user
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        update = data.get('update')   # base64 string
        if not doc_id or not update:
            return

        # Broadcast to all peers except sender
        sio.emit('yjs:update', {
            'update':  update,
            'user_id': current_user.id,
        }, room=f'doc_{doc_id}', skip_sid=True)

        # Persist update to Redis (debounced flush to MySQL happens in service)
        try:
            from services.yjs_state_service import YjsStateService
            YjsStateService.apply_update(doc_id, update)
        except Exception as exc:
            current_app.logger.debug(f'[yjs] Error caching update doc={doc_id}: {exc}')

    @sio.on('yjs:sync_request')
    def on_yjs_sync_request(data: dict):
        """
        Cliente solicita el estado completo del documento Yjs.
        Responde directamente al solicitante con el state (Redis → MySQL fallback).
        """
        from flask_login import current_user
        from flask_socketio import emit
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        if not doc_id:
            return
        try:
            from services.yjs_state_service import YjsStateService
            state = YjsStateService.get_state(doc_id)
            if state:
                emit('yjs:sync', {'state': state, 'doc_id': doc_id})
        except Exception as exc:
            current_app.logger.debug(f'[yjs] Error sending sync to client doc={doc_id}: {exc}')

    @sio.on('yjs:awareness')
    def on_yjs_awareness(data: dict):
        """
        Broadcast awareness state (cursors, selection, user presence).
        """
        from flask_login import current_user
        if not current_user.is_authenticated:
            return
        doc_id = data.get('doc_id')
        awareness = data.get('awareness')
        if not doc_id or not awareness:
            return
        sio.emit('yjs:awareness', {
            'awareness': awareness,
            'user_id':   current_user.id,
        }, room=f'doc_{doc_id}', skip_sid=True)
