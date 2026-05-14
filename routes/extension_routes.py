"""
Extension Request Blueprint — prórroga flow.

Student endpoints  (session-auth via student_id in flask_session):
  POST /api/extension-request                     → create
  GET  /api/extension-request/<invitation_id>     → get status

Teacher endpoints (Flask-Login required):
  GET  /api/teacher/extension-requests            → paginated list (filters: status, workspace_id)
  PUT  /api/teacher/extension-request/<id>/approve
  PUT  /api/teacher/extension-request/<id>/reject

Evidence upload:
  POST /api/extension-request/upload-evidence     → SeaweedFS (or local fallback)
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, session as flask_session
from flask_login import login_required, current_user

from settings.extensions import db, logger as ext_logger

extension_bp = Blueprint('extension', __name__)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_student():
    sid = flask_session.get('student_id')
    if not sid:
        return None
    from models.models import StudentWorkspaceUser
    return StudentWorkspaceUser.query.get(sid)


def _notify_teacher(workspace, invitation, ext_req):
    """Send EXTENSION_REQUESTED notification to the workspace owner."""
    try:
        from models.models import NotificationType
        from services.notification_service import NotificationService
        stu = ext_req.student
        NotificationService.create(
            user_id=workspace.owner_id,
            type=NotificationType.EXTENSION_REQUESTED,
            title="New Extension Request",
            message=f"{stu.full_name} requested an extension for \"{workspace.title}\".",
            url=f"/home",   # teacher lands on workspace view
            priority=1,
            metadata={
                'extension_request_id': ext_req.id,
                'workspace_id': workspace.id,
                'invitation_id': invitation.id,
                'student_email': stu.email,
            },
            course_id=workspace.id,
        )
    except Exception as exc:
        log.warning(f"[ExtensionRequest] Teacher notify failed: {exc}")


def _notify_student(ext_req, approved: bool):
    """Send EXTENSION_APPROVED / EXTENSION_REJECTED notification to student."""
    try:
        from models.models import NotificationType
        from services.notification_service import NotificationService
        inv = ext_req.invitation
        ws  = inv.workspace if inv else None
        ntype = NotificationType.EXTENSION_APPROVED if approved else NotificationType.EXTENSION_REJECTED
        title = "Extension Approved ✅" if approved else "Extension Rejected ❌"
        if approved and ext_req.new_deadline:
            ws_title = ws.title if ws else 'assignment'
            msg = (f'Your extension for "{ws_title}" was approved. '
                   f"New deadline: {ext_req.new_deadline.strftime('%b %d, %Y %H:%M')} UTC.")
        else:
            ws_title = ws.title if ws else 'assignment'
            msg = (f'Your extension request for "{ws_title}" was rejected. '
                   + (f"Reason: {ext_req.review_comment}" if ext_req.review_comment else ""))

        NotificationService.create(
            student_id=ext_req.student_id,
            type=ntype,
            title=title,
            message=msg,
            url=f"/invite/{inv.token}" if inv else None,
            priority=1,
            metadata={
                'extension_request_id': ext_req.id,
                'workspace_id': ws.id if ws else None,
                'new_deadline': ext_req.new_deadline.isoformat() if ext_req.new_deadline else None,
            },
            course_id=ws.id if ws else None,
        )
    except Exception as exc:
        log.warning(f"[ExtensionRequest] Student notify failed: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/extension-request  — Student creates a request
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/extension-request', methods=['POST'])
def create_extension_request():
    student = _get_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    data          = request.get_json(silent=True) or {}
    invitation_id = data.get('invitation_id')
    reason_raw    = data.get('reason', '').strip()
    description   = (data.get('description') or '').strip()
    evidence_url  = (data.get('evidence_url') or '').strip() or None

    if not invitation_id or not reason_raw:
        return jsonify({'success': False, 'error': 'invitation_id and reason are required'}), 400

    from models.models import (WorkspaceInvitation, ExtensionRequest,
                               ExtensionRequestReason, ExtensionRequestStatus)

    inv = WorkspaceInvitation.query.get(invitation_id)
    if not inv or inv.email.lower() != student.email.lower():
        return jsonify({'success': False, 'error': 'Invitation not found'}), 404

    ws = inv.workspace
    if not ws:
        return jsonify({'success': False, 'error': 'Workspace not found'}), 404

    # ── Business rules ─────────────────────────────────────────────────────

    # 1. Feature flag
    if not getattr(ws, 'allow_extensions', True):
        log.warning(f"[ExtensionRequest] Extensions disabled for ws={ws.id}")
        return jsonify({'success': False, 'error': 'Extensions are not allowed for this assignment'}), 403

    # 2. Document must be closed / past deadline
    now = datetime.utcnow()
    effective_deadline = inv.extended_deadline or ws.deadline
    if now <= effective_deadline and not ws.is_closed:
        return jsonify({'success': False, 'error': 'Assignment is still open — no extension needed'}), 400

    # 3. Time window: must be within deadline + extension_window_hours
    # FOR TESTING: we use a very large window (10000h) even if the DB says 48h
    db_window = getattr(ws, 'extension_window_hours', 48)
    window_hours = max(db_window, 10000) 
    cutoff = effective_deadline + timedelta(hours=window_hours)
    
    if now > cutoff:
        log.warning(f"[ExtensionRequest] Window expired for ws={ws.id}. Now={now}, Cutoff={cutoff}")
        return jsonify({
            'success': False,
            'error': f'Extension window has expired (max {window_hours}h after deadline). Your deadline was {effective_deadline.strftime("%Y-%m-%d")}'
        }), 403

    # 4. Uniqueness — only 1 active request per student/invitation
    existing = ExtensionRequest.query.filter_by(
        student_id=student.id,
        invitation_id=invitation_id
    ).first()
    if existing:
        return jsonify({
            'success': False,
            'error': 'You already have a request for this assignment',
            'existing': existing.to_dict()
        }), 409

    # 5. Validate reason enum
    try:
        reason_enum = ExtensionRequestReason(reason_raw)
    except ValueError:
        return jsonify({'success': False, 'error': f'Invalid reason: {reason_raw}'}), 400

    # 6. description required if reason=other
    if reason_enum == ExtensionRequestReason.OTHER and not description:
        return jsonify({'success': False, 'error': 'Description is required when reason is "Other"'}), 400

    # ── Create ─────────────────────────────────────────────────────────────
    ext_req = ExtensionRequest(
        student_id=student.id,
        invitation_id=invitation_id,
        reason=reason_enum,
        description=description or None,
        evidence_url=evidence_url,
        status=ExtensionRequestStatus.PENDING,
    )
    db.session.add(ext_req)
    db.session.commit()

    # Notify teacher
    _notify_teacher(ws, inv, ext_req)

    log.info(f"[ExtensionRequest] Created id={ext_req.id} student={student.email} ws={ws.id}")
    return jsonify({'success': True, 'request': ext_req.to_dict()}), 201


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/extension-request/<invitation_id>  — Student polls status
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/extension-request/<int:invitation_id>')
def get_extension_request(invitation_id):
    student = _get_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    from models.models import ExtensionRequest
    ext_req = ExtensionRequest.query.filter_by(
        student_id=student.id,
        invitation_id=invitation_id
    ).first()

    if not ext_req:
        return jsonify({'success': True, 'request': None})

    return jsonify({'success': True, 'request': ext_req.to_dict()})


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/extension-request/upload-evidence  — SeaweedFS evidence upload
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/extension-request/upload-evidence', methods=['POST'])
def upload_evidence():
    student = _get_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    f = request.files['file']
    if f.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else ''
    if ext not in {'pdf', 'jpg', 'jpeg', 'png'}:
        return jsonify({'success': False, 'error': 'Only PDF, JPG and PNG are allowed'}), 400

    file_bytes = f.read()
    filename   = f"evidence/{uuid.uuid4()}.{ext}"

    # Try SeaweedFS first, fall back to local uploads/
    try:
        from io import BytesIO
        from settings.extensions import minio_client
        minio_client.put_object(
            bucket_name='evidence',
            object_name=filename,
            data=BytesIO(file_bytes),
            length=len(file_bytes),
            content_type=f'application/{ext}' if ext == 'pdf' else f'image/{ext}',
        )
        url = f"/api/extension-request/evidence/{filename}"
        log.info(f"[ExtensionRequest] Evidence uploaded to SeaweedFS: {filename}")
    except Exception as weed_err:
        log.warning(f"[ExtensionRequest] SeaweedFS unavailable, using local fallback: {weed_err}")
        from flask import current_app
        local_dir = os.path.join(current_app.config.get('UPLOAD_FOLDER', 'uploads'), 'evidence')
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, os.path.basename(filename))
        with open(local_path, 'wb') as fh:
            fh.write(file_bytes)
        url = f"/uploads/evidence/{os.path.basename(filename)}"

    return jsonify({'success': True, 'url': url, 'filename': filename})


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/teacher/extension-requests  — Teacher lists all requests
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/teacher/extension-requests')
@login_required
def teacher_list_requests():
    from models.models import ExtensionRequest, WorkspaceInvitation, Workspace, ExtensionRequestStatus

    page        = request.args.get('page', 1, type=int)
    per_page    = request.args.get('per_page', 20, type=int)
    status_raw  = request.args.get('status')
    workspace_id = request.args.get('workspace_id', type=int)

    # Base query — only requests for workspaces owned by this teacher
    query = (
        db.session.query(ExtensionRequest)
        .join(WorkspaceInvitation, ExtensionRequest.invitation_id == WorkspaceInvitation.id)
        .join(Workspace, WorkspaceInvitation.workspace_id == Workspace.id)
        .filter(Workspace.owner_id == current_user.id)
    )

    if status_raw:
        try:
            query = query.filter(ExtensionRequest.status == ExtensionRequestStatus(status_raw))
        except ValueError:
            pass

    if workspace_id:
        query = query.filter(WorkspaceInvitation.workspace_id == workspace_id)

    query = query.order_by(ExtensionRequest.requested_at.desc())
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'success': True,
        'total': total,
        'page': page,
        'per_page': per_page,
        'requests': [r.to_dict() for r in items]
    })


# ─────────────────────────────────────────────────────────────────────────────
# PUT /api/teacher/extension-request/<id>/approve
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/teacher/extension-request/<int:req_id>/approve', methods=['PUT'])
@login_required
def teacher_approve(req_id):
    from models.models import (ExtensionRequest, WorkspaceInvitation, Workspace,
                               ExtensionRequestStatus, WorkspaceExtensionLog)

    ext_req = ExtensionRequest.query.get_or_404(req_id)
    inv     = ext_req.invitation
    ws      = inv.workspace if inv else None

    if not ws or ws.owner_id != current_user.id:
        return jsonify({'success': False, 'error': 'Not authorized'}), 403

    if ext_req.status != ExtensionRequestStatus.PENDING:
        return jsonify({'success': False, 'error': 'Request is no longer pending'}), 400

    data         = request.get_json(silent=True) or {}
    new_deadline_raw = data.get('new_deadline')   # ISO string from teacher
    comment      = (data.get('comment') or '').strip() or None

    if not new_deadline_raw:
        return jsonify({'success': False, 'error': 'new_deadline is required'}), 400

    try:
        new_dl = datetime.fromisoformat(new_deadline_raw.replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid datetime format'}), 400

    now = datetime.utcnow()

    # Update extension request
    ext_req.status         = ExtensionRequestStatus.APPROVED
    ext_req.reviewed_at    = now
    ext_req.reviewed_by    = current_user.id
    ext_req.new_deadline   = new_dl
    ext_req.review_comment = comment

    # Apply to invitation's extended_deadline
    prev_deadline = inv.extended_deadline or ws.deadline
    inv.extended_deadline = new_dl

    # Reopen workspace for this student if new deadline is in the future
    if new_dl > now and ws.is_closed:
        ws.is_closed  = False
        ws.closed_at  = None

    # Audit log
    audit = WorkspaceExtensionLog(
        workspace_id=ws.id,
        invitation_id=inv.id,
        action='INDIVIDUAL_EXTENSION',
        previous_deadline=prev_deadline,
        new_deadline=new_dl,
        created_by=current_user.id,
    )
    db.session.add(audit)
    db.session.commit()

    _notify_student(ext_req, approved=True)

    log.info(f"[ExtensionRequest] Approved id={req_id} new_dl={new_dl} by user={current_user.id}")
    return jsonify({'success': True, 'request': ext_req.to_dict()})


# ─────────────────────────────────────────────────────────────────────────────
# PUT /api/teacher/extension-request/<id>/reject
# ─────────────────────────────────────────────────────────────────────────────

@extension_bp.route('/api/teacher/extension-request/<int:req_id>/reject', methods=['PUT'])
@login_required
def teacher_reject(req_id):
    from models.models import ExtensionRequest, Workspace, ExtensionRequestStatus

    ext_req = ExtensionRequest.query.get_or_404(req_id)
    inv     = ext_req.invitation
    ws      = inv.workspace if inv else None

    if not ws or ws.owner_id != current_user.id:
        return jsonify({'success': False, 'error': 'Not authorized'}), 403

    if ext_req.status != ExtensionRequestStatus.PENDING:
        return jsonify({'success': False, 'error': 'Request is no longer pending'}), 400

    data    = request.get_json(silent=True) or {}
    comment = (data.get('comment') or '').strip() or None

    ext_req.status         = ExtensionRequestStatus.REJECTED
    ext_req.reviewed_at    = datetime.utcnow()
    ext_req.reviewed_by    = current_user.id
    ext_req.review_comment = comment
    db.session.commit()

    _notify_student(ext_req, approved=False)

    log.info(f"[ExtensionRequest] Rejected id={req_id} by user={current_user.id}")
    return jsonify({'success': True, 'request': ext_req.to_dict()})
