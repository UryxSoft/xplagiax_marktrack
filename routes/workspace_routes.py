from flask import Blueprint, request, jsonify, render_template, url_for
from flask_login import login_required, current_user
from flask_mail import Message
from datetime import datetime
from settings.extensions import db, mail, csrf
import re
import logging
import secrets
from services.cache_service import cache
from services.mail_service import mail_service

logger = logging.getLogger(__name__)

workspace_bp = Blueprint('workspace', __name__)
csrf.exempt(workspace_bp)


# ============================================================================
# WORKSPACE CRUD API
# ============================================================================

@workspace_bp.route('/api/workspaces', methods=['GET'])
@login_required
def list_workspaces():
    """List all workspaces owned by the current user"""
    cache_key = f"ws:list:{current_user.id}"
    cached_data = cache.get(cache_key)
    if cached_data:
        return jsonify(cached_data)

    from models.models import Workspace
    workspaces = Workspace.query.filter_by(owner_id=current_user.id)\
        .order_by(Workspace.created_at.desc()).all()
    
    result = []
    for ws in workspaces:
        base_dict = ws.to_dict()
        
        # Calculate derived metrics
        total = base_dict.get('total_invited', 0)
        active = base_dict.get('total_active', 0)
        
        # Determine completed vs active
        # the status can be 'pending', 'active' or 'completed'. Let's count them
        counts = {'pending': 0, 'active': 0, 'completed': 0, 'blocked': 0}
        participants = []
        for inv in base_dict.get('invitations', []):
            st = inv.get('status', 'pending')
            counts[st] = counts.get(st, 0) + 1
            participants.append({
                'email': inv.get('email'),
                'status': st,
                'first_name': inv.get('first_name'),
                'last_name': inv.get('last_name'),
                'access_time': inv.get('accessed_at')
            })

        accessed = counts['active'] + counts['completed']
        completed = counts['completed']
        
        base_dict['metrics'] = {
            'total_users': total,
            'accessed': accessed,
            'completed': completed,
            'access_rate': (accessed / total) if total > 0 else 0,
            'completion_rate': (completed / total) if total > 0 else 0
        }
        base_dict['participants'] = participants
        
        # Keep original arrays just in case, or drop them if they inflate payload
        result.append(base_dict)

    response_data = {
        'success': True,
        'workspaces': result
    }
    
    # Cache for 10 minutes logic (refresh TTL)
    cache.set(cache_key, response_data, ttl=600)

    return jsonify(response_data)


@workspace_bp.route('/api/workspaces', methods=['POST'])
@login_required
def create_workspace():
    """Create a new workspace with invitations and send emails"""
    from models.models import Workspace, WorkspaceInvitation, Document

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    # Validate required fields
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'Title is required'}), 400

    description = (data.get('description') or '').strip()
    classroom = (data.get('classroom') or '').strip()

    try:
        sd_str = data.get('start_date', '').replace('Z', '+00:00')
        start_date = datetime.fromisoformat(sd_str).replace(tzinfo=None)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Invalid start_date'}), 400

    try:
        raw_end_date = data.get('end_date') or data.get('deadline', '')
        ed_str = raw_end_date.replace('Z', '+00:00')
        deadline = datetime.fromisoformat(ed_str).replace(tzinfo=None)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Invalid end_date'}), 400

    if deadline < start_date:
        return jsonify({'success': False, 'error': 'End Date cannot be before Start Date'}), 400

    # Validate emails (gracefully accept 'participants' or 'emails')
    emails = data.get('participants') or data.get('emails', [])
    if not emails or len(emails) == 0:
        return jsonify({'success': False, 'error': 'At least one participant email is required'}), 400

    email_pattern = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
    clean_emails = []
    seen = set()
    for email in emails:
        email = email.strip().lower()
        if not email_pattern.match(email):
            return jsonify({'success': False, 'error': f'Invalid email: {email}'}), 400
        if email in seen:
            return jsonify({'success': False, 'error': f'Duplicate email: {email}'}), 400
        seen.add(email)
        clean_emails.append(email)

    # Validate word limit if enabled
    has_word_limit = data.get('word_limit_enabled') if data.get('word_limit_enabled') is not None else data.get('has_word_limit', False)
    word_limit = data.get('word_limit')
    
    if has_word_limit:
        if not word_limit or not isinstance(word_limit, int):
            return jsonify({'success': False, 'error': 'Word limit must be a valid number'}), 400
        if word_limit < 50:
            return jsonify({'success': False, 'error': 'Word limit must be at least 50'}), 400
        if word_limit > 50000:
            return jsonify({'success': False, 'error': 'Word limit cannot exceed 50,000'}), 400

    try:
        # Create workspace
        workspace = Workspace(
            title=title,
            description=description,
            classroom=classroom,
            start_date=start_date,
            deadline=deadline,
            owner_id=current_user.id,
            has_word_limit=has_word_limit,
            word_limit=word_limit if has_word_limit else None
        )
        db.session.add(workspace)
        db.session.flush()  # Get workspace.id

        # Create invitations with tokens
        invitations = []
        for email in clean_emails:
            invitation = WorkspaceInvitation(
                workspace_id=workspace.id,
                email=email,
                token=secrets.token_urlsafe(32),
                status='pending'
            )
            db.session.add(invitation)
            invitations.append(invitation)

        db.session.commit()

        # Send emails (non-blocking: log errors but don't fail)
        base_url = request.host_url.rstrip('/')
        emails_sent = 0
        email_errors = []
        for invitation in invitations:
            try:
                invite_url = f"{base_url}/homework?token={invitation.token}"
                send_invitation_email(
                    to_email=invitation.email,
                    workspace_title=title,
                    classroom=classroom,
                    deadline=deadline,
                    invite_url=invite_url
                )
                invitation.sent_at = datetime.utcnow()
                emails_sent += 1
            except Exception as e:
                err_msg = str(e)
                logger.error(f"Error sending email to {invitation.email}: {err_msg}")
                email_errors.append(f"{invitation.email}: {err_msg}")

        db.session.commit()

        # Invalidate workspace listing cache
        cache.invalidate(f"ws:list:{current_user.id}")

        return jsonify({
            'success': True,
            'workspace': workspace.to_dict(),
            'emails_sent': emails_sent,
            'total_emails': len(clean_emails),
            'email_errors': email_errors
        }), 201

    except Exception as e:
        db.session.rollback()
        logger.exception("Error creating workspace")
        return jsonify({'success': False, 'error': 'Internal error creating workspace'}), 500


@workspace_bp.route('/api/workspaces/<int:workspace_id>', methods=['PUT'])
@login_required
def update_workspace(workspace_id):
    """Update an existing workspace, including adding/removing invitations"""
    from models.models import Workspace, WorkspaceInvitation

    workspace = Workspace.query.filter_by(id=workspace_id, owner_id=current_user.id).first()
    if not workspace:
        return jsonify({'success': False, 'error': 'Workspace not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    if 'title' in data:
        title = (data['title'] or '').strip()
        if not title:
            return jsonify({'success': False, 'error': 'Title is required'}), 400
        workspace.title = title

    if 'description' in data:
        workspace.description = (data['description'] or '').strip()

    if 'classroom' in data:
        workspace.classroom = (data['classroom'] or '').strip()

    if 'start_date' in data:
        try:
            sd_str = data['start_date'].replace('Z', '+00:00')
            workspace.start_date = datetime.fromisoformat(sd_str).replace(tzinfo=None)
        except (ValueError, TypeError, AttributeError):
            return jsonify({'success': False, 'error': 'Invalid start date'}), 400

    end_date_key = 'end_date' if 'end_date' in data else 'deadline'
    if end_date_key in data:
        try:
            ed_str = data[end_date_key].replace('Z', '+00:00')
            new_deadline = datetime.fromisoformat(ed_str).replace(tzinfo=None)
            if new_deadline < workspace.start_date:
                return jsonify({'success': False, 'error': 'Deadline cannot be before start date'}), 400
            workspace.deadline = new_deadline
            # Reopen if deadline extended
            if datetime.utcnow() < new_deadline:
                workspace.is_closed = False
        except (ValueError, TypeError, AttributeError):
            return jsonify({'success': False, 'error': 'Invalid end date'}), 400

    if 'is_closed' in data:
        workspace.is_closed = bool(data['is_closed'])
    
    # Handle word limit updates
    has_limit_key = 'word_limit_enabled' if 'word_limit_enabled' in data else 'has_word_limit'
    if has_limit_key in data:
        has_word_limit = bool(data[has_limit_key])
        workspace.has_word_limit = has_word_limit
        
        # If word limit is being enabled, validate the limit value
        if has_word_limit and 'word_limit' in data:
            word_limit = data['word_limit']
            if not word_limit or not isinstance(word_limit, int):
                return jsonify({'success': False, 'error': 'Word limit must be a valid number'}), 400
            if word_limit < 50:
                return jsonify({'success': False, 'error': 'Word limit must be at least 50'}), 400
            if word_limit > 50000:
                return jsonify({'success': False, 'error': 'Word limit cannot exceed 50,000'}), 400
            workspace.word_limit = word_limit
        elif not has_word_limit:
            workspace.word_limit = None
    elif 'word_limit' in data and workspace.has_word_limit:
        # Update word limit if already enabled
        word_limit = data['word_limit']
        if word_limit:
            if not isinstance(word_limit, int) or word_limit < 50 or word_limit > 50000:
                return jsonify({'success': False, 'error': 'Invalid word limit value'}), 400
            workspace.word_limit = word_limit

    emails_added = 0
    emails_removed = 0

    # Handle email list changes
    emails_key = 'participants' if 'participants' in data else 'emails'
    if emails_key in data:
        new_emails = set()
        email_pattern = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
        for em in data[emails_key]:
            em = em.strip().lower()
            if email_pattern.match(em):
                new_emails.add(em)

        # Get current invitation emails
        existing_invitations = WorkspaceInvitation.query.filter_by(workspace_id=workspace.id).all()
        existing_emails = {inv.email: inv for inv in existing_invitations}

        # Remove invitations that are no longer in the list
        for email, inv in existing_emails.items():
            if email not in new_emails:
                db.session.delete(inv)
                emails_removed += 1

        # Add new invitations
        new_invitations = []
        for email in new_emails:
            if email not in existing_emails:
                invitation = WorkspaceInvitation(
                    workspace_id=workspace.id,
                    email=email,
                    token=secrets.token_urlsafe(32),
                    status='pending'
                )
                db.session.add(invitation)
                new_invitations.append(invitation)
                emails_added += 1

    try:
        db.session.commit()

        # Send emails for new invitations (after commit so tokens are persisted)
        if 'emails' in data and new_invitations:
            base_url = request.host_url.rstrip('/')
            for invitation in new_invitations:
                try:
                    invite_url = f"{base_url}/homework?token={invitation.token}"
                    send_invitation_email(
                        to_email=invitation.email,
                        workspace_title=workspace.title,
                        classroom=workspace.classroom or '',
                        deadline=workspace.deadline,
                        invite_url=invite_url
                    )
                    invitation.sent_at = datetime.utcnow()
                except Exception as e:
                    logger.error(f"Error sending email to {invitation.email}: {e}")
            db.session.commit()

        # Invalidate cached list since changes were made
        cache.invalidate(f"ws:list:{current_user.id}")

        return jsonify({
            'success': True,
            'workspace': workspace.to_dict(),
            'emails_added': emails_added,
            'emails_removed': emails_removed
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': 'Error updating workspace'}), 500


@workspace_bp.route('/api/workspaces/<int:workspace_id>', methods=['DELETE'])
@login_required
def delete_workspace(workspace_id):
    """Delete a workspace and all its invitations"""
    from models.models import Workspace, WorkspaceInvitation, EssaySubmissionMetrics

    workspace = Workspace.query.filter_by(id=workspace_id, owner_id=current_user.id).first()
    if not workspace:
        return jsonify({'success': False, 'error': 'Workspace not found'}), 404

    try:
        # 1. Manually clean up metrics first (highest level of dependency)
        EssaySubmissionMetrics.query.filter_by(workspace_id=workspace.id).delete()
        
        # 2. Cleanup invitations (will also remove their back-references)
        WorkspaceInvitation.query.filter_by(workspace_id=workspace.id).delete()
        
        # 3. Finally delete the workspace itself
        db.session.delete(workspace)
        db.session.commit()
        
        cache.invalidate(f"ws:list:{current_user.id}")
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting workspace {workspace_id}: {e}")
        return jsonify({'success': False, 'error': f'Error deleting workspace: {str(e)}'}), 500


@workspace_bp.route('/api/workspaces/<int:workspace_id>/detail', methods=['GET'])
@login_required
def workspace_detail(workspace_id):
    """Get full details for a workspace including all invitation and document info"""
    from models.models import Workspace
    workspace = Workspace.query.filter_by(id=workspace_id, owner_id=current_user.id).first()
    if not workspace:
        return jsonify({'success': False, 'error': 'Workspace not found'}), 404

    # Using to_dict and overriding invitations with full data
    data = workspace.to_dict()
    invitations = workspace.invitations.all()
    
    # Calculate derived metrics matching the aggregated logic
    total = len(invitations)
    counts = {'pending': 0, 'active': 0, 'completed': 0, 'blocked': 0}
    participants = []
    
    for inv in invitations:
        st = inv.status or 'pending'
        counts[st] = counts.get(st, 0) + 1
        participants.append({
            'id': inv.id,
            'email': inv.email,
            'status': st,
            'first_name': inv.first_name,
            'last_name': inv.last_name,
            'access_time': inv.accessed_at.isoformat() if inv.accessed_at else None,
            'sent_at': inv.sent_at.isoformat() if inv.sent_at else None
        })

    accessed = counts['active'] + counts['completed']
    completed = counts['completed']
    
    data['metrics'] = {
        'total_users': total,
        'accessed': accessed,
        'completed': completed,
        'access_rate': (accessed / total) if total > 0 else 0,
        'completion_rate': (completed / total) if total > 0 else 0
    }
    data['participants'] = participants

    return jsonify({
        'success': True,
        'workspace': data
    })


# ============================================================================
# INVITATION / INVITE ROUTES
# ============================================================================

@workspace_bp.route('/invite/<token>', methods=['GET'])
def access_invite(token):
    """Validate token and render invite page — student session aware"""
    from models.models import WorkspaceInvitation, StudentWorkspaceUser
    from flask import session as flask_session

    invitation = WorkspaceInvitation.query.filter_by(token=token).first()
    if not invitation:
        return render_template('invite.html', error='This link is invalid or has expired.', invitation=None, workspace=None)

    workspace = invitation.workspace
    if not workspace:
        return render_template('invite.html', error='This link is invalid or has expired.', invitation=None, workspace=None)

    # Check if blocked
    if invitation.status == 'blocked':
        return render_template('invite.html', error='Your access has been blocked.', invitation=None, workspace=None)

    # Check deadline / closed
    if workspace.check_deadline():
        return render_template('invite.html', error='This assignment has been closed.',
                               invitation=invitation, workspace=workspace, is_closed=True)

    # ── Student session checks ─────────────────────────────────────────────
    student_id    = flask_session.get('student_id')
    student_email = flask_session.get('student_email', '')

    # Is an active student session that matches this invitation's email?
    student_logged_in = (
        student_id is not None and
        student_email.lower() == invitation.email.lower()
    )

    # Detect if a logged-in professor (workspace owner) is viewing the student's page
    from flask_login import current_user as _cu
    is_owner = _cu.is_authenticated and workspace and workspace.owner_id == _cu.id

    # ── REDIRECTION LOGIC ──────────────────────────────────────────────
    # If it's not the owner and not a correctly logged-in student, 
    # redirect to the /homework portal to handle login/registration.
    if not is_owner and not student_logged_in:
        return redirect(url_for('student.homework', token=token))

    # Does a student account already exist for this invitation?
    # (Used to determine if we show login or register in homework)
    student_registered = (
        StudentWorkspaceUser.query
        .filter_by(invitation_id=invitation.id)
        .first()
    ) is not None

    # If we are here, it's either the owner or the correct student logged in.
    # We show the editor directly.
    needs_registration = False
    show_login_modal   = False

    return render_template('invite.html',
                           error=None,
                           invitation=invitation,
                           workspace=workspace,
                           needs_registration=needs_registration,
                           show_login_modal=show_login_modal,
                           student_registered=student_registered,
                           student_logged_in=student_logged_in,
                           is_closed=False,
                           token=token,
                           is_owner=is_owner)



@workspace_bp.route('/invite/<token>/register', methods=['POST'])
def register_participant(token):
    """Register student: name + password → StudentWorkspaceUser + session"""
    from models.models import WorkspaceInvitation, Document, StudentWorkspaceUser
    from flask import session as flask_session
    import re

    invitation = WorkspaceInvitation.query.filter_by(token=token).first()
    if not invitation:
        return jsonify({'success': False, 'error': 'Invalid link'}), 404

    workspace = invitation.workspace
    if not workspace or workspace.check_deadline():
        return jsonify({'success': False, 'error': 'This assignment has been closed'}), 403

    if invitation.status == 'blocked':
        return jsonify({'success': False, 'error': 'Access blocked'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    first_name = (data.get('first_name') or '').strip()
    last_name  = (data.get('last_name')  or '').strip()
    password   = data.get('password', '')
    password2  = data.get('password_confirm', password) # Fallback to password if missing

    if not first_name or not last_name:
        return jsonify({'success': False, 'error': 'First name and last name are required'}), 400

    # ── Password validation ────────────────────────────────────────────────
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400
    if not re.search(r'[A-Z]', password):
        return jsonify({'success': False, 'error': 'Password must contain at least one uppercase letter'}), 400
    if not re.search(r'\d', password):
        return jsonify({'success': False, 'error': 'Password must contain at least one number'}), 400
    if password != password2:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400

    try:
        # Update invitation
        invitation.first_name = first_name
        invitation.last_name  = last_name
        invitation.status     = 'active'
        invitation.accessed_at = datetime.utcnow()

        # Create document for this participant if not exists
        if not invitation.document_id:
            doc = Document(
                title=workspace.title,
                content_delta='{"ops":[{"insert":"\\n"}]}',
                content_html='',
                storage_type='database',
                document_type='workspace',
                owner_id=workspace.owner_id,
                size_bytes=0
            )
            db.session.add(doc)
            db.session.flush()
            invitation.document_id = doc.id

        # ── Create StudentWorkspaceUser (if not already exists) ───────────
        existing_student = (
            StudentWorkspaceUser.query
            .filter_by(invitation_id=invitation.id)
            .first()
        )
        if not existing_student:
            student = StudentWorkspaceUser(
                email=invitation.email,
                first_name=first_name,
                last_name=last_name,
                invitation_id=invitation.id,
            )
            student.set_password(password)
            db.session.add(student)
            db.session.flush()  # get student.id before commit
        else:
            student = existing_student
            student.first_name = first_name
            student.last_name  = last_name

        db.session.commit()

        # ── Set 30-day persistent session ─────────────────────────────────
        from flask import session as flask_session
        flask_session.permanent = True
        flask_session['student_id']    = student.id
        flask_session['student_email'] = invitation.email
        flask_session['student_name']  = f"{first_name} {last_name}".strip()

        return jsonify({
            'success': True,
            'document_id': invitation.document_id,
            'message': 'Registration successful'
        })
    except Exception as e:
        db.session.rollback()
        logger.exception("Error registering participant")
        return jsonify({'success': False, 'error': 'Internal error'}), 500


@workspace_bp.route('/invite/<token>/document', methods=['GET'])
def get_invite_document(token):
    """Get the document content for an invitation"""
    from models.models import WorkspaceInvitation
    import json

    invitation = WorkspaceInvitation.query.filter_by(token=token).first()
    if not invitation or invitation.status not in ('active', 'pending', 'completed'):
        return jsonify({'success': False, 'error': 'Invalid access'}), 403

    workspace = invitation.workspace
    is_closed = workspace.check_deadline() if workspace else True

    if not invitation.document_id or not invitation.document:
        return jsonify({
            'success': True,
            'document': {'delta': {"ops": [{"insert": "\n"}]}, 'html': ''},
            'workspace': {
                'has_word_limit': getattr(workspace, 'has_word_limit', False) if workspace else False,
                'word_limit': getattr(workspace, 'word_limit', None) if workspace else None
            },
            'is_closed': is_closed
        })

    doc = invitation.document
    delta = {}
    html = doc.content_html or ''

    if getattr(doc, 'storage_type', 'database') == 'minio' and doc.minio_path:
        try:
            from settings.utils import load_from_minio_compressed
            minio_delta, minio_html = load_from_minio_compressed(doc.minio_path)
            if minio_delta:
                delta = minio_delta
            if minio_html:
                html = minio_html
        except Exception:
            pass

    if not delta and doc.content_delta:
        try:
            delta = json.loads(doc.content_delta)
        except Exception:
            delta = {"ops": [{"insert": "\n"}]}

    return jsonify({
        'success': True,
        'document': {
            'id': doc.id,
            'title': doc.title,
            'delta': delta,
            'html': html
        },
        'workspace': {
            'id': workspace.id if workspace else None,
            'has_word_limit': getattr(workspace, 'has_word_limit', False) if workspace else False,
            'word_limit': getattr(workspace, 'word_limit', None) if workspace else None
        },
        'invitation_id': invitation.id,
        'is_closed': is_closed
    })


@workspace_bp.route('/invite/<token>/document', methods=['PUT'])
def save_invite_document(token):
    """Save document content from invited participant"""
    from models.models import WorkspaceInvitation
    import json

    invitation = WorkspaceInvitation.query.filter_by(token=token).first()
    if not invitation or invitation.status == 'blocked':
        return jsonify({'success': False, 'error': 'Invalid access'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data'}), 400

    is_final = bool(data.get('is_final'))
    workspace = invitation.workspace

    # Non-final saves must respect deadline/closed state.
    # Final saves (signature + completion) are always allowed so content + metrics
    # are never silently dropped when a session closes at the last second.
    if not is_final:
        if not workspace or workspace.check_deadline():
            return jsonify({'success': False, 'error': 'This assignment has been closed'}), 403
        if invitation.status == 'blocked':
            return jsonify({'success': False, 'error': 'Invalid access'}), 403

    if not invitation.document_id or not invitation.document:
        return jsonify({'success': False, 'error': 'No document assigned'}), 404

    doc = invitation.document
    try:
        if 'delta' in data:
            doc.content_delta = json.dumps(data['delta'])
        if 'html' in data:
            doc.content_html = data['html']
        doc.size_bytes = len(doc.content_delta.encode('utf-8')) if doc.content_delta else 0
        
        # Consolidate metrics saving (REFINED DESIGN: Update existing or create new)
        metrics_payload = data.get('metrics')
        if metrics_payload:
            from models.models import EssaySubmissionMetrics
            from datetime import datetime

            # UPSERT: Find existing metrics for this invitation or create new
            metrics = EssaySubmissionMetrics.query.filter_by(invitation_id=invitation.id).first()
            
            if not metrics:
                metrics = EssaySubmissionMetrics(
                    document_id=doc.id,
                    workspace_id=workspace.id,
                    invitation_id=invitation.id
                )
                db.session.add(metrics)

            # Update cumulative values
            metrics.total_time_seconds = int(metrics_payload.get('totalTimeSeconds', 0) or 0)
            metrics.effective_time_seconds = int(metrics_payload.get('effectiveTypingSeconds', 0) or 0)
            metrics.keystrokes = int(metrics_payload.get('totalKeystrokes', 0) or 0)
            metrics.backspaces = int(metrics_payload.get('backspacesCount', 0) or 0)
            metrics.avg_hold_ms = float(metrics_payload.get('avgHoldTimeMs', 0) or 0)
            metrics.avg_interkey_ms = float(metrics_payload.get('avgInterKeyMs', 0) or 0)
            metrics.long_pauses = int(metrics_payload.get('longPausesCount', 0) or 0)
            metrics.wpm = float(metrics_payload.get('approxWPM', 0) or 0)
            
            # FIX BUG 3: CONCATENATE raw_logs (audit events only), don't overwrite.
            # The frontend now only sends audit-critical events (max 200), so this stays lean.
            new_logs = metrics_payload.get('rawLogs', [])
            if new_logs:
                existing_logs = metrics.raw_logs or []
                combined = existing_logs + new_logs
                metrics.raw_logs = combined[-200:]  # Keep last 200 audit events max
            
            # FIX: Merge incremental de activity_by_minute en lugar de sobreescribir.
            # El frontend acumula keystrokes desde el inicio de sesión. Usando max() por
            # minuto conservamos el valor más actualizado y no se pierden datos históricos.
            new_abm = metrics_payload.get('activityByMinute', {})
            existing_abm = (metrics.session_metadata or {}).get('activity_by_minute', {})
            merged_abm = dict(existing_abm)
            for k, v in new_abm.items():
                str_k = str(k)
                merged_abm[str_k] = max(int(merged_abm.get(str_k, 0)), int(v or 0))

            metrics.session_metadata = {
                'medium_pauses': int(metrics_payload.get('mediumPausesCount', 0) or 0),
                'total_focus_seconds': int(metrics_payload.get('totalFocusSeconds', 0) or 0),
                'paste_count': int(metrics_payload.get('pasteCount', 0) or 0),
                'large_deletions': int(metrics_payload.get('largeDeletionsCount', 0) or 0),
                'longest_burst': int(metrics_payload.get('longestBurst', 0) or 0),
                'activity_by_minute': merged_abm,
            }
            # FIX BUG 2: Do NOT duplicate quill_delta here — it already lives in
            # marktrack_documents.content_delta (saved above). Reduces ~40-50KB per student.
            # metrics.quill_delta = data.get('delta')  # REMOVED: duplicate data
            metrics.submitted_at = datetime.utcnow()  # Track last update time

        db.session.commit()

        # FIX: Invalidar cache Redis DESPUÉS del commit para que metrics.id exista siempre.
        # Antes estaba antes del commit → en registros nuevos metrics.id era None → delete sin efecto.
        if metrics_payload:
            try:
                metrics_record = EssaySubmissionMetrics.query.filter_by(invitation_id=invitation.id).first()
                if metrics_record and metrics_record.id:
                    cache.delete(f"metrics:detail:{metrics_record.id}")
            except Exception as cache_err:
                logger.warning(f'[workspace] Cache invalidation failed (non-critical): {cache_err}')
        return jsonify({'success': True, 'message': 'Saved'})
    except Exception as e:
        db.session.rollback()
        logger.exception(f"Error saving document {doc.id} for invite {token}: {str(e)}")
        return jsonify({'success': False, 'error': f'Error saving document: {str(e)}'}), 500


# ============================================================================
# EMAIL SENDING
# ============================================================================

def send_invitation_email(to_email, workspace_title, classroom, deadline, invite_url):
    """Send invitation email with professional, table-based SaaS template"""
    deadline_str = deadline.strftime('%B %d, %Y at %H:%M')
    subject = f"Workspace Invitation: {workspace_title}"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0; padding:0; background-color:#ffffff; font-family:Arial, sans-serif;">

    <!-- Background Layer (White) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; padding:40px 0;">
      <tr>
        <td align="center">

          <!-- Main Container (Radial Gradient) -->
          <table width="600" cellpadding="0" cellspacing="0" style="background-image: radial-gradient(circle at 12% 12%, rgb(74, 114, 152) 0%, rgb(42, 59, 85) 40%, rgb(93, 74, 74) 80%, rgb(122, 96, 80) 100%); background-color:rgb(42, 59, 85); border-radius:16px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); color:#ffffff;">

            <!-- Header (Solid #007AFF) -->
            <tr>
              <td style="background:#007AFF; padding:35px; text-align:center; color:#ffffff;">

                <!-- Stylized Icon Badge -->
                <div style="display:inline-block; width:52px; height:52px; border:2px solid #ffffff; border-radius:50%; font-size:24px; font-weight:bold; line-height:52px; margin-bottom:15px; text-align:center; background:rgba(255,255,255,0.1);">
                  M
                </div>

                <h1 style="margin:0; font-size:24px; font-weight:800; letter-spacing:0.5px; text-shadow:0 2px 4px rgba(0,0,0,0.2);">
                  MARKTRACK
                </h1>

                <p style="margin:8px 0 0; font-size:12px; opacity:0.9; text-transform:uppercase; letter-spacing:1.2px;">
                  Project Workspace Access
                </p>
              </td>
            </tr>

            <!-- Body Contents (Within Gradient Area) -->
            <tr>
              <td style="padding:45px;">

                <h2 style="margin:0 0 18px; font-size:24px; color:#ffffff; font-weight:700;">
                  {workspace_title}
                </h2>

                <p style="font-size:16px; color:rgba(255,255,255,0.85); line-height:1.7; margin:0 0 28px;">
                  Hello, you’ve been granted access to a new collaborative workspace.
                  Launch your workspace dashboard to begin your assignment.
                </p>

                {"<div style='background:rgba(255,255,255,0.08); border-left:4px solid #007AFF; border-radius:6px; padding:20px; margin:28px 0;'><p style='margin:0; font-size:11px; color:rgba(255,255,255,0.6); font-weight:700; text-transform:uppercase;'>Context / Folder</p><p style='margin:8px 0 0; font-size:18px; font-weight:700; color:#ffffff;'>" + classroom + "</p></div>" if classroom else ""}

                <!-- Access Button -->
                <table width="100%" style="margin:36px 0;">
                  <tr>
                    <td align="center">
                      <a href="{invite_url}"
                         style="background:#007AFF; color:#ffffff; padding:18px 55px; text-decoration:none; border-radius:12px; font-size:17px; font-weight:bold; display:inline-block; box-shadow:0 8px 20px rgba(0,0,0,0.3);">
                        LAUNCH WORKSPACE
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Deadline Box -->
                <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); padding:18px; border-radius:10px;">
                   <p style="margin:0; font-size:12px; color:white; font-weight:600;">ACTIVE DEADLINE</p>
                   <p style="margin:6px 0 0; font-size:16px; color:#007AFF; font-weight:bold;">
                     {deadline_str}
                   </p>
                </div>

                <p style="margin-top:35px; font-size:12px; color:rgba(255,255,255,0.4); text-align:center;">
                  This secure link is exclusive to {to_email}.
                </p>

              </td>
            </tr>

            <!-- Footer (Base #007AFF) -->
            <tr>
              <td style="background:#007AFF; padding:30px; text-align:center; font-size:12px; color:#ffffff;">
                <div style="opacity:0.75; letter-spacing:0.5px;">
                  © 2026 MARKTRACK ANALYTICS • SECURE ACCESS SYSTEM
                </div>
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>

    </body>
    </html>
    """

    msg = Message(
        subject=subject,
        recipients=[to_email],
        html=html_body,
        sender=('Marktrack', 'xplagiax@gmail.com')
    )
    # Usar MailService para envío con redundancia de proveedores
    mail_service.send(msg)

    
@workspace_bp.route('/review/<token>')
@login_required
def review_document(token):
    """Render the read-only review view for a document securely"""
    from flask import current_app
    from models.models import Document, WorkspaceInvitation, EssaySubmissionMetrics
    from itsdangerous.url_safe import URLSafeTimedSerializer

    signer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    try:
        # Token expires in 24 hours
        data, timestamp = signer.loads(token, max_age=86400, return_timestamp=True)
        document_id = data.get('document_id')
    except Exception:
        return jsonify({'error': 'Token inválido o expirado'}), 403

    # Get document and verify access
    document = Document.query.get_or_404(document_id)
    
    # Verify the user owns this document or owns the related workspace
    invitation = WorkspaceInvitation.query.filter_by(document_id=document.id).first()
    
    if invitation:
        workspace = invitation.workspace
        # Verify current user owns the workspace
        if workspace.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
            
        # Expire token if the session was closed AFTER the token was generated
        if workspace.is_closed and workspace.closed_at:
            if timestamp.replace(tzinfo=None) < workspace.closed_at:
                return jsonify({'error': 'Token expirado porque la sesión fue cerrada.'}), 403
    elif document.owner_id != current_user.id:
        return jsonify({'error': 'No autorizado'}), 403

    metrics = EssaySubmissionMetrics.query.filter_by(document_id=document.id).first()
    
    metrics_data = {}
    if metrics:
        effective_sec = metrics.effective_time_seconds or 0
        focus_sec = (metrics.session_metadata or {}).get('total_focus_seconds', 0)
        
        metrics_data = {
            'total_words': document.size_bytes // 5, # Rough estimation if real word_count isn't explicitly set initially
            'writing_time': f"{effective_sec // 3600}h {(effective_sec % 3600) // 60}m {effective_sec % 60}s" if effective_sec > 3600 else f"{effective_sec // 60}m {effective_sec % 60}s",
            'focus_time': f"{focus_sec // 3600}h {(focus_sec % 3600) // 60}m {focus_sec % 60}s" if focus_sec > 3600 else f"{focus_sec // 60}m {focus_sec % 60}s",
            'keystrokes': metrics.keystrokes or 0,
            'backspaces': metrics.backspaces or 0,
            'wpm': round(metrics.wpm or 0, 1),
            'long_pauses': metrics.long_pauses or 0,
            'paste_events': (metrics.session_metadata or {}).get('paste_count', 0),
            'large_deletions': (metrics.session_metadata or {}).get('large_deletions', 0),
            'longest_burst': (metrics.session_metadata or {}).get('longest_burst', 0),
            'raw_logs': metrics.raw_logs if metrics else [],
            'activity_by_minute': (metrics.session_metadata or {}).get('activity_by_minute', {})
        }

    # Extract real content (handling JSON and Minio)
    content_delta_raw = None
    content_html_raw = None
    import json
    if getattr(document, 'storage_type', 'database') == 'minio' and document.minio_path:
        try:
            from settings.utils import load_from_minio_compressed
            delta, html = load_from_minio_compressed(document.minio_path)
            content_delta_raw = delta
            content_html_raw = html
        except Exception as e:
            logger.error(f"Error loading minio compressed file for document {document.id}: {e}")
    else:
        if document.content_delta:
            try:
                content_delta_raw = json.loads(document.content_delta)
            except Exception:
                content_delta_raw = document.content_delta
        content_html_raw = document.content_html

    return render_template('review.html', 
                         document=document,
                         invitation=invitation,
                         content_delta_raw=content_delta_raw,
                         content_html_raw=content_html_raw,
                         metrics=metrics_data,
                         now=datetime.now())


# ============================================================================
# AI ANALYSIS PROXY (XplagiaX Engine)
# ============================================================================

@workspace_bp.route('/api/ai/analyze', methods=['POST'])
@login_required
def ai_analyze_proxy():
    """Proxy request to the XplagiaX AI analysis microservice."""
    import requests as req_lib
    import os

    data = request.get_json()
    if not data or not data.get('text'):
        return jsonify({'status': 'error', 'message': 'No text provided'}), 400

    ai_service_url = os.environ.get(
        'XPLAGIAX_URL', 'http://localhost:5006/analyze_document'
    )

    try:
        resp = req_lib.post(
            ai_service_url,
            json={
                "text": data['text'],
                "plugins": data.get('plugins', [
                    "ai_detection",
                    "citation_check",
                    "stylometric_analysis"
                ]),
            },
            timeout=60,
        )
        resp.raise_for_status()
        return jsonify(resp.json())
    except req_lib.exceptions.Timeout:
        logger.warning('[ai_analyze_proxy] XplagiaX timeout')
        return jsonify({'status': 'error', 'message': 'Analysis service timeout'}), 504
    except req_lib.exceptions.ConnectionError:
        logger.warning('[ai_analyze_proxy] XplagiaX connection refused')
        return jsonify({'status': 'error', 'message': 'Analysis service unavailable'}), 503
    except Exception as e:
        logger.error(f'[ai_analyze_proxy] Error: {e}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ============================================================================
# IMAGE ANALYSIS PROXY (Image Microservice :5010)
# ============================================================================

@workspace_bp.route('/api/media/ai-detection', methods=['POST'])
@login_required
def media_ai_detection_proxy():
    """Proxy: detect AI-generated images via image microservice."""
    import requests as req_lib, os
    data = request.get_json()
    if not data or not data.get('image_url'):
        return jsonify({'status': 'error', 'message': 'image_url required'}), 400

    svc = os.environ.get('IMAGE_SVC_URL', 'http://localhost:5010')
    try:
        resp = req_lib.post(
            f'{svc}/api/v1/search/ai-detection',
            json={'image_url': data['image_url']},
            timeout=30,
        )
        resp.raise_for_status()
        return jsonify(resp.json())
    except req_lib.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': 'Image service timeout'}), 504
    except req_lib.exceptions.ConnectionError:
        return jsonify({'status': 'error', 'message': 'Image service unavailable'}), 503
    except Exception as e:
        logger.error(f'[media_ai_detection] {e}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@workspace_bp.route('/api/media/plagiarism', methods=['POST'])
@login_required
def media_plagiarism_proxy():
    """Proxy: check image plagiarism via image microservice."""
    import requests as req_lib, os
    data = request.get_json()
    if not data or not data.get('image_url'):
        return jsonify({'status': 'error', 'message': 'image_url required'}), 400

    svc = os.environ.get('IMAGE_SVC_URL', 'http://localhost:5010')
    try:
        resp = req_lib.post(
            f'{svc}/api/v1/search/plagiarism',
            json={
                'image_url': data['image_url'],
                'similarity_threshold': data.get('similarity_threshold', 0.85),
            },
            timeout=30,
        )
        resp.raise_for_status()
        return jsonify(resp.json())
    except req_lib.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': 'Image service timeout'}), 504
    except req_lib.exceptions.ConnectionError:
        return jsonify({'status': 'error', 'message': 'Image service unavailable'}), 503
    except Exception as e:
        logger.error(f'[media_plagiarism] {e}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ============================================================================
# STATE MANAGEMENT & EXTENSIONS API
# ============================================================================


@workspace_bp.route('/api/workspaces/<int:ws_id>/close', methods=['POST'])
@login_required
def close_workspace(ws_id):
    from models.models import Workspace, WorkspaceExtensionLog
    ws = Workspace.query.filter_by(id=ws_id, owner_id=current_user.id).first_or_404()
    
    ws.is_closed = True
    ws.closed_at = datetime.utcnow()
    
    log_entry = WorkspaceExtensionLog(
        workspace_id=ws.id,
        action='MANUAL_CLOSE',
        previous_deadline=ws.deadline,
        new_deadline=ws.deadline,
        created_by=current_user.id
    )
    db.session.add(log_entry)
    db.session.commit()
    
    # Invalidate cache
    cache.delete(f"ws:list:{current_user.id}")
    cache.delete(f"ws:access:{ws_id}")
    return jsonify({'success': True, 'message': 'Workspace cerrado exitosamente'})

@workspace_bp.route('/api/workspaces/<int:ws_id>/reopen', methods=['POST'])
@login_required
def reopen_workspace(ws_id):
    from models.models import Workspace, WorkspaceExtensionLog
    data = request.get_json() or {}
    new_deadline_str = data.get('new_deadline')
    
    if not new_deadline_str:
        return jsonify({'success': False, 'error': 'Missing new_deadline'}), 400
        
    try:
        new_deadline = datetime.fromisoformat(new_deadline_str.replace('Z', '+00:00'))
    except ValueError:
        return jsonify({'success': False, 'error': 'Formato de fecha inválido'}), 400

    ws = Workspace.query.filter_by(id=ws_id, owner_id=current_user.id).first_or_404()
    
    previous = ws.deadline
    ws.is_closed = False
    ws.closed_at = None
    ws.deadline = new_deadline
    
    log_entry = WorkspaceExtensionLog(
        workspace_id=ws.id,
        action='GLOBAL_REOPEN',
        previous_deadline=previous,
        new_deadline=new_deadline,
        created_by=current_user.id
    )
    db.session.add(log_entry)
    db.session.commit()
    
    cache.delete(f"ws:list:{current_user.id}")
    cache.delete(f"ws:access:{ws_id}")
    return jsonify({'success': True, 'message': 'Workspace reabierto'})

@workspace_bp.route('/api/workspaces/<int:ws_id>/extensions', methods=['POST'])
@login_required
def manage_extensions(ws_id):
    from models.models import Workspace, WorkspaceInvitation, WorkspaceExtensionLog
    from datetime import timedelta
    
    data = request.get_json() or {}
    invitation_ids = data.get('invitation_ids', [])
    add_minutes = data.get('add_minutes')
    new_deadline_str = data.get('new_deadline')
    
    ws = Workspace.query.filter_by(id=ws_id, owner_id=current_user.id).first_or_404()
    
    if not invitation_ids:
        # Extend globally if no IDs provided, without officially reopening
        if add_minutes:
            ws.deadline = ws.deadline + timedelta(minutes=int(add_minutes))
        elif new_deadline_str:
            try:
                ws.deadline = datetime.fromisoformat(new_deadline_str.replace('Z', '+00:00'))
            except ValueError:
                return jsonify({'success': False, 'error': 'Formato de fecha inválido'}), 400
                
        db.session.add(WorkspaceExtensionLog(
            workspace_id=ws.id, action='GLOBAL_EXTENSION', 
            new_deadline=ws.deadline, created_by=current_user.id
        ))
    else:
        # Individual extensions
        invitations = WorkspaceInvitation.query.filter(
            WorkspaceInvitation.id.in_(invitation_ids),
            WorkspaceInvitation.workspace_id == ws.id
        ).all()
        
        for inv in invitations:
            base_time = inv.extended_deadline or ws.deadline
            previous = base_time
            if add_minutes:
                new_dt = base_time + timedelta(minutes=int(add_minutes))
            elif new_deadline_str:
                new_dt = datetime.fromisoformat(new_deadline_str.replace('Z', '+00:00'))
            else:
                continue
                
            inv.extended_deadline = new_dt
            db.session.add(WorkspaceExtensionLog(
                workspace_id=ws.id, invitation_id=inv.id, action='INDIVIDUAL_EXTENSION',
                previous_deadline=previous, new_deadline=new_dt, created_by=current_user.id
            ))
            
    db.session.commit()
    cache.delete(f"ws:list:{current_user.id}")
    cache.delete(f"ws:access:{ws_id}")
    return jsonify({'success': True, 'message': 'Extensiones aplicadas'})

@workspace_bp.route('/api/workspaces/invitation/<int:inv_id>/status', methods=['POST'])
@login_required
def update_invitation_status(inv_id):
    """
    Permite al profesor actualizar manualmente el estado de una invitación 
    (ej: para marcarla como 'completed' si el estudiante olvidó firmar).
    """
    from models.models import WorkspaceInvitation
    inv = WorkspaceInvitation.query.get_or_404(inv_id)
    
    # Verificar que el profesor sea el dueño del workspace
    if inv.workspace.owner_id != current_user.id:
        return jsonify({'success': False, 'error': 'No autorizado'}), 403
    
    data = request.get_json() or {}
    new_status = data.get('status')
    
    if new_status not in ['pending', 'active', 'completed', 'blocked']:
        return jsonify({'success': False, 'error': 'Estado inválido'}), 400
        
    inv.status = new_status
    db.session.commit()
    
    # Invalidar caches
    cache.delete(f"ws:list:{current_user.id}")
    cache.delete(f"ws:detail:{inv.workspace_id}")
    
    return jsonify({
        'success': True, 
        'message': f'Estado de {inv.email} actualizado a {new_status}'
    })
