"""
Student workspace blueprint — isolated auth domain.

Endpoints:
  GET  /homework                      → student dashboard
  POST /student/login                 → authenticate student (session-based)
  POST /student/logout                → clear student session
  GET  /api/student/workspaces        → list all invitations for logged-in student
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from flask import (
    Blueprint, jsonify, redirect, render_template,
    request, session as flask_session, url_for
)

from settings.extensions import limiter

logger = logging.getLogger(__name__)

student_bp = Blueprint('student', __name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_current_student():
    """Return the logged-in StudentWorkspaceUser or None."""
    student_id = flask_session.get('student_id')
    if not student_id:
        return None
    from models.models import StudentWorkspaceUser
    return StudentWorkspaceUser.query.get(student_id)


def _compute_tag(workspace, invitation) -> str:
    """Determine the status tag shown on the homework card."""
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    if workspace.is_closed or workspace.deadline < now:
        return 'CLOSED'
    if workspace.deadline < now + timedelta(hours=48):
        return 'SOON FINISH'
    if invitation.status == 'pending':
        return 'NEW'
    return 'ACTIVE'

def _get_tag_class(tag):
    return {
        'CLOSED':      'tag-closed',
        'SOON FINISH': 'tag-soon',
        'NEW':         'tag-new',
        'ACTIVE':      'tag-active',
        'COLLAB':      'tag-active'
    }.get(tag, 'tag-active')


# ─────────────────────────────────────────────────────────────────────────────
# GET /homework — main student dashboard
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/homework')
def homework():
    """
    Student homework dashboard.
    Handles 'token' query param for incoming invitations.
    """
    from models.models import WorkspaceInvitation, StudentWorkspaceUser
    from settings.extensions import db

    token = request.args.get('token')
    collab_token = request.args.get('collab_token')
    student = _get_current_student()
    student_email = flask_session.get('student_email', '')

    show_registration_modal = False
    show_invite_login_modal = False
    invitation_context = None

    # ── Handle Invitation context (Professor -> Student) ──────────────
    if token:
        invitation = WorkspaceInvitation.query.filter_by(token=token).first()
        if invitation:
            if student and student.email.lower() == invitation.email.lower():
                pass
            else:
                invitation_context = {
                    'token':     token,
                    'email':     invitation.email,
                    'workspace': invitation.workspace,
                    'title':     invitation.workspace.title if invitation.workspace else None,
                    'type':      'student'
                }
                has_account = StudentWorkspaceUser.query.filter_by(email=invitation.email).first() is not None
                if has_account: show_invite_login_modal = True
                else: show_registration_modal = True

    # ── Handle Collaboration context (Student -> Student) ─────────────
    if collab_token:
        from routes.collaborators_routes import verify_collab_token, DocumentCollaborator
        collab_id = verify_collab_token(collab_token)
        if collab_id:
            collab = DocumentCollaborator.query.get(collab_id)
            if collab:
                if student and student.email.lower() == collab.user.email.lower():
                    # Link if not linked
                    if not collab.user_id:
                        collab.user_id = student.id
                        db.session.commit()
                else:
                    invitation_context = {
                        'token':     collab_token,
                        'email':     collab.user.email,
                        'title':     collab.document.title if collab.document else 'Document',
                        'type':      'collab'
                    }
                    has_account = StudentWorkspaceUser.query.filter_by(email=collab.user.email).first() is not None
                    if has_account: show_invite_login_modal = True
                    else: show_registration_modal = True

    # ── Generic Auth Check ────────────────────────────────────────────
    show_generic_login = not student and not show_registration_modal and not show_invite_login_modal

    # ── Load Assignments (if logged in) ───────────────────────────────
    assignments = []
    if student:
        invitations = (
            WorkspaceInvitation.query
            .filter(
                WorkspaceInvitation.email == student_email,
                WorkspaceInvitation.status.in_(['pending', 'active', 'completed'])
            )
            .all()
        )

        # Load collaborative documents
        from models.models import DocumentCollaborator
        collab_entries = DocumentCollaborator.query.filter_by(user_id=student.id, accepted=True).all()

        # ── Check for deadline reminders ───────────────────────────────────
        try:
            _generate_deadline_notifications(student)
        except Exception as e:
            from flask import current_app
            current_app.logger.error(f"[Homework] Deadline check failed: {e}")

        for inv in invitations:
            ws = inv.workspace
            if not ws: continue
            
            tag = _compute_tag(ws, inv)
            
            # Fetch document metrics (if document exists)
            doc_id = inv.document_id
            word_count = 0
            doc_date = ws.created_at # Fallback to workspace creation date
            
            if doc_id:
                from models.models import Document
                doc = Document.query.get(doc_id)
                if doc:
                    word_count = (doc.size_bytes // 5) if doc.size_bytes else 0
                    doc_date = doc.updated_at or doc.created_at or doc_date

            assignments.append({
                'invitation': inv,
                'workspace':  ws,
                'tag':        tag,
                'tag_class':  _get_tag_class(tag),
                'token':      inv.token,
                'deadline':   ws.deadline,
                'classroom':  ws.classroom or '',
                'doc_id':     doc_id,
                'word_count': word_count,
                'doc_date':   doc_date,
                'is_collab':  False
            })
            
        for c in collab_entries:
            doc = c.document
            if not doc: continue
            assignments.append({
                'title':      doc.title,
                'workspace':  None,
                'tag':        'COLLAB',
                'tag_class':  _get_tag_class('COLLAB'),
                'token':      '',
                'deadline':   None,
                'classroom':  'Collaborative Work',
                'doc_id':     doc.id,
                'word_count': (doc.size_bytes // 5) if doc.size_bytes else 0,
                'doc_date':   doc.updated_at or doc.created_at,
                'is_collab':  True
            })

    return render_template('homework.html',
                           student=student,
                           assignments=assignments,
                           show_login=show_generic_login,
                           show_registration=show_registration_modal,
                           show_invite_login=show_invite_login_modal,
                           invite_context=invitation_context)


# ─────────────────────────────────────────────────────────────────────────────
# POST /student/login
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/student/login', methods=['POST'])
@limiter.limit("8/minute")
def student_login():
    """Authenticate a student by email + password."""
    data     = request.get_json(silent=True) or {}
    email    = (data.get('email') or '').strip().lower()
    password = data.get('password', '')
    token    = data.get('token', '')  # standard invitation
    collab_token = data.get('collab_token', '') # collaboration invitation

    if not email or not password:
        return jsonify({'success': False, 'error': 'Email and password are required'}), 400

    from models.models import StudentWorkspaceUser

    # No token context: find most recently created account for this email
    student = (
        StudentWorkspaceUser.query
        .filter_by(email=email, is_active=True)
        .order_by(StudentWorkspaceUser.created_at.desc())
        .first()
    )

    if not student:
        # Check if they at least exist as a main User to give better feedback
        from models.models import User
        if User.query.filter_by(email=email).first():
            return jsonify({'success': False, 'error': 'You have a professor account, but this document requires a student account. Please use the registration link in your email.'}), 401
        return jsonify({'success': False, 'error': 'Account not found for this email.'}), 401

    if not student.check_password(password):
        return jsonify({'success': False, 'error': 'Incorrect password. Please use the password you created for your MarkTrack student account.'}), 401

    if not student.is_active:
        return jsonify({'success': False, 'error': 'Account is not active'}), 403

    # Update last login
    student.last_login = datetime.utcnow()
    from settings.extensions import db
    db.session.commit()

    # Set 30-day session
    flask_session.permanent = True
    flask_session['student_id']    = student.id
    flask_session['student_email'] = student.email
    flask_session['student_name']  = student.full_name

    # Process collaboration token if present upon login
    if collab_token:
        from routes.collaborators_routes import verify_collab_token, DocumentCollaborator
        collab_id = verify_collab_token(collab_token)
        if collab_id:
            collab = DocumentCollaborator.query.get(collab_id)
            if collab and not collab.user_id:
                collab.user_id = student.id
                db.session.commit()

    redirect_url = f'/invite/{token}' if token else '/homework'
    return jsonify({
        'success': True,
        'redirect': redirect_url,
        'student': student.to_dict()
    })


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/student/forgot-password
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/api/student/forgot-password', methods=['POST'])
def forgot_password():
    """Send a password recovery email to the student."""
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()

    if not email:
        return jsonify({'success': False, 'error': 'Email is required'}), 400

    from models.models import StudentWorkspaceUser
    student = StudentWorkspaceUser.query.filter_by(email=email, is_active=True).first()
    
    if not student:
        return jsonify({'success': True, 'message': 'If an account exists, a recovery email was sent.'})

    from flask import current_app
    from itsdangerous.url_safe import URLSafeTimedSerializer
    from flask_mail import Message
    from services.mail_service import mail_service

    s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    token = s.dumps({'student_id': student.id, 'purpose': 'password_reset'})
    
    reset_link = url_for('student.reset_password_view', token=token, _external=True)
    
    # EMERGENCY LOG: Print to console in case email fails or is slow
    current_app.logger.info(f"\n[PASSWORD RESET] Email: {email}\nLink: {reset_link}\n")
    
    msg = Message(
        subject="MarkTrack - Password Recovery",
        recipients=[email],
        html=f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; color: #333;">
            <p>Hello {student.first_name},</p>
            <p>We received a request to reset your password for MarkTrack.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{reset_link}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
            </div>
            <p style="font-size: 13px; color: #666;">If you did not request a password reset, please ignore this email. The link will expire in 1 hour.</p>
        </div>
        """
    )
    
    try:
        mail_service.send(msg)
    except Exception as e:
        current_app.logger.error(f"Error sending forgot password email: {e}")
        return jsonify({'success': False, 'error': 'Could not send recovery email. Please try again later.'}), 500
        
    return jsonify({'success': True, 'message': 'If an account exists, a recovery email was sent.'})


# ─────────────────────────────────────────────────────────────────────────────
# GET /homework/reset-password/<token>
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/homework/reset-password/<token>', methods=['GET'])
def reset_password_view(token):
    return render_template('homework.html', 
                          show_login=False,
                          show_registration=False,
                          show_invite_login=False,
                          reset_token=token)


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/student/reset-password
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/api/student/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    token = data.get('token')
    new_password = data.get('new_password')
    
    if not token or not new_password:
        return jsonify({'success': False, 'error': 'Token and new password are required'}), 400
        
    if len(new_password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters long'}), 400

    from flask import current_app
    from itsdangerous.url_safe import URLSafeTimedSerializer
    from itsdangerous.exc import SignatureExpired, BadSignature
    
    s = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    
    try:
        payload = s.loads(token, max_age=3600)
    except SignatureExpired:
        return jsonify({'success': False, 'error': 'The reset link has expired.'}), 400
    except BadSignature:
        return jsonify({'success': False, 'error': 'Invalid reset link.'}), 400
        
    student_id = payload.get('student_id')
    
    from models.models import StudentWorkspaceUser
    student = StudentWorkspaceUser.query.get(student_id)
    
    if not student:
        return jsonify({'success': False, 'error': 'Account not found.'}), 404
        
    from settings.extensions import db
    student.set_password(new_password)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Password has been updated successfully.'})


# ─────────────────────────────────────────────────────────────────────────────
# POST /student/logout
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/student/logout', methods=['POST'])
def student_logout():
    flask_session.pop('student_id',    None)
    flask_session.pop('student_email', None)
    flask_session.pop('student_name',  None)
    return jsonify({'success': True, 'redirect': '/homework'})


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/student/workspaces — JSON list for client
# ─────────────────────────────────────────────────────────────────────────────

@student_bp.route('/api/student/workspaces')
def get_student_workspaces():
    student = _get_current_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    from models.models import WorkspaceInvitation

    invitations = (
        WorkspaceInvitation.query
        .filter(WorkspaceInvitation.email == flask_session.get('student_email', ''))
        .all()
    )

    result = []
    for inv in invitations:
        ws = inv.workspace
        if not ws: continue
        tag = _compute_tag(ws, inv)
        result.append({
            'token':     inv.token,
            'title':     ws.title,
            'classroom': ws.classroom or '',
            'deadline':  ws.deadline.isoformat(),
            'status':    inv.status,
            'tag':       tag,
        })

    return jsonify({'success': True, 'assignments': result})


@student_bp.route('/api/student/notifications')
def get_student_notifications():
    student = _get_current_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401

    from services.notification_service import NotificationService
    notifications = NotificationService.get_recent(student.id, is_student=True, limit=15)
    unread_count = NotificationService.get_unread_count(student.id, is_student=True)
    
    return jsonify({
        'success': True,
        'notifications': notifications,
        'unread_count': unread_count
    })


@student_bp.route('/api/student/notifications/<int:notif_id>/read', methods=['POST'])
def mark_student_notification_read(notif_id):
    student = _get_current_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    from services.notification_service import NotificationService
    success = NotificationService.mark_read(notif_id, student.id, is_student=True)
    return jsonify({'success': success})


@student_bp.route('/api/student/notifications/read-all', methods=['POST'])
def mark_all_student_notifications_read():
    student = _get_current_student()
    if not student:
        return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    from services.notification_service import NotificationService
    success = NotificationService.mark_all_read(student.id, is_student=True)
    return jsonify({'success': success})


def _generate_deadline_notifications(student):
    from models.models import WorkspaceInvitation, Notification, NotificationType
    from services.notification_service import NotificationService
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    one_day_out = now + timedelta(hours=24)
    invitations = WorkspaceInvitation.query.filter_by(email=student.email, status='active').all()
    for inv in invitations:
        ws = inv.workspace
        if not ws or ws.is_closed: continue
        if now < ws.deadline < one_day_out:
            existing = Notification.query.filter_by(student_id=student.id, type=NotificationType.DEADLINE_REMINDER).first()
            if not existing:
                NotificationService.create(
                    student_id=student.id,
                    type=NotificationType.DEADLINE_REMINDER,
                    title="Assignment closing soon!",
                    message=f"The assignment '{ws.title}' closes soon.",
                    url=f"/invite/{inv.token}",
                    priority=1,
                    course_id=ws.id
                )

@student_bp.route('/api/student/settings')
def get_student_auth_settings():
    student = _get_current_student()
    if not student: return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    return jsonify({'success': True, 'profile': {'first_name': student.first_name, 'last_name': student.last_name, 'email': student.email}})

@student_bp.route('/api/student/settings', methods=['POST'])
def update_student_settings():
    student = _get_current_student()
    if not student: return jsonify({'success': False, 'error': 'Not authenticated'}), 401
    data = request.get_json(silent=True) or {}
    if 'profile' in data:
        p = data['profile']
        if 'first_name' in p: student.first_name = p['first_name']
        if 'last_name' in p: student.last_name = p['last_name']
    if 'password' in data and data['password']: student.set_password(data['password'])
    from settings.extensions import db
    db.session.commit()
    return jsonify({'success': True, 'student': student.to_dict()})
