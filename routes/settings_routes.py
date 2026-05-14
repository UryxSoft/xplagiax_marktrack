from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from settings.extensions import db, csrf
from datetime import datetime
import os
import uuid

settings_bp = Blueprint('settings', __name__, url_prefix='/api/settings')
csrf.exempt(settings_bp)

AVATAR_ALLOWED = {'png', 'jpg', 'jpeg', 'webp'}
AVATAR_MAX_BYTES = 2 * 1024 * 1024  # 2 MB


# ─────────────────────────────────────────────────────────────────────────────
# GET  /api/settings/          → All settings + user profile
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/', methods=['GET'])
@login_required
def get_settings():
    """Get all user settings + basic profile"""
    try:
        try:
            # Reescrito con SQLAlchemy nativo, parametrizado como texto o ORM
            from models.models import Institution
            inst_result = Institution.query.order_by(Institution.institution).all()
            institutions = [{'id': str(r.id), 'name': r.institution} for r in inst_result]
        except Exception:
            institutions = []

        return jsonify({
            'status': 'success',
            'institutions': institutions,
            'data': current_user.get_settings(),
            'user': {
                'name':     current_user.name,
                'lastname': current_user.lastname,
                'email':    current_user.email,
                'avatar':   current_user.avatar,
                'institute': current_user.institute,
                'country':   current_user.country,
                'oauth_provider': current_user.oauth_provider,
                'session_created_at': current_user.session_created_at.isoformat() if current_user.session_created_at else None,
                'last_login': current_user.last_login.isoformat() if current_user.last_login else None,
            }
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/settings/          → Partial update of settings_json
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/', methods=['POST'])
@login_required
def update_settings():
    """Partial update of settings_json categories"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400

        # Whitelist of allowed categories and keys
        ALLOWED = {
            'preferences': {'language', 'compact_view'},
            'workspace':   {'default_folder_color', 'share_link_expiry_days'},
            'ai':          {'creativity_level'},
            'notifications': {'email_digests'},
        }

        sanitized = {}
        for category, values in data.items():
            if category not in ALLOWED:
                continue
            if not isinstance(values, dict):
                continue
            sanitized[category] = {k: v for k, v in values.items() if k in ALLOWED[category]}

        if not sanitized:
            return jsonify({'status': 'error', 'message': 'No valid settings provided'}), 400

        current_user.update_settings(sanitized)

        return jsonify({
            'status': 'success',
            'message': 'Settings updated',
            'data': current_user.get_settings()
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/settings/profile   → name, lastname, institute, country
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/profile', methods=['POST'])
@login_required
def update_profile():
    """Update primary user profile fields"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400

        changed = False

        if 'name' in data:
            val = str(data['name']).strip()[:100]
            if val:
                current_user.name = val
                changed = True

        if 'lastname' in data:
            val = str(data['lastname']).strip()[:100]
            current_user.lastname = val
            changed = True

        if 'institute' in data:
            val = str(data['institute']).strip()[:255]
            current_user.institute = val
            changed = True

        if 'country' in data:
            val = str(data['country']).strip()[:100]
            current_user.country = val
            changed = True

        if changed:
            db.session.commit()

        return jsonify({
            'status': 'success',
            'message': 'Profile updated',
            'user': {
                'name':      current_user.name,
                'lastname':  current_user.lastname,
                'institute': current_user.institute,
                'country':   current_user.country,
            }
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/settings/avatar    → multipart file upload
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/avatar', methods=['POST'])
@login_required
def upload_avatar():
    """Upload a profile avatar image (PNG/JPG/WEBP, max 2 MB)"""
    try:
        if 'avatar' not in request.files:
            return jsonify({'status': 'error', 'message': 'No file provided'}), 400

        file = request.files['avatar']
        if not file or file.filename == '':
            return jsonify({'status': 'error', 'message': 'No file selected'}), 400

        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if ext not in AVATAR_ALLOWED:
            return jsonify({'status': 'error', 'message': 'Only PNG, JPG, JPEG or WEBP allowed'}), 400

        # Check size
        file.seek(0, os.SEEK_END)
        size = file.tell()
        file.seek(0)
        if size > AVATAR_MAX_BYTES:
            return jsonify({'status': 'error', 'message': 'File exceeds 2 MB limit'}), 400

        # Save to avatars folder
        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'settings/uploads')
        avatars_dir = os.path.join(upload_folder, 'avatars')
        os.makedirs(avatars_dir, exist_ok=True)

        # Delete old avatar file if it was locally stored
        if current_user.avatar and current_user.avatar.startswith('/static/uploads/avatars/'):
            old_path = os.path.join(
                os.path.dirname(upload_folder),
                current_user.avatar.lstrip('/')
            )
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        filename = f"avatar_{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"
        save_path = os.path.join(avatars_dir, filename)
        file.save(save_path)

        avatar_url = f"/static/uploads/avatars/{filename}"
        current_user.avatar = avatar_url
        db.session.commit()

        return jsonify({
            'status': 'success',
            'avatar_url': avatar_url,
            'message': 'Avatar updated'
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/settings/password  → change password (non-OAuth users only)
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/password', methods=['POST'])
@login_required
def change_password():
    """Change password — only for non-OAuth accounts"""
    try:
        if current_user.oauth_provider:
            return jsonify({
                'status': 'error',
                'message': f'This account uses {current_user.oauth_provider} OAuth. Password cannot be changed here.'
            }), 400

        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400

        old_pw = data.get('old_password', '').strip()
        new_pw = data.get('new_password', '').strip()

        if not old_pw or not new_pw:
            return jsonify({'status': 'error', 'message': 'Both fields are required'}), 400

        if len(new_pw) < 8:
            return jsonify({'status': 'error', 'message': 'New password must be at least 8 characters'}), 400

        # Use werkzeug for password checking (User model uses _password_hash)
        from werkzeug.security import check_password_hash, generate_password_hash
        if not current_user._password_hash:
            return jsonify({'status': 'error', 'message': 'No password set for this account'}), 400

        if not check_password_hash(current_user._password_hash, old_pw):
            return jsonify({'status': 'error', 'message': 'Current password is incorrect'}), 400

        current_user._password_hash = generate_password_hash(new_pw)
        db.session.commit()

        return jsonify({'status': 'success', 'message': 'Password changed successfully'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/settings/sessions/terminate  → invalidate all sessions
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/sessions/terminate', methods=['POST'])
@login_required
def terminate_sessions():
    """Terminate all active sessions for the current user"""
    try:
        current_user.invalidate_session()
        db.session.commit()
        return jsonify({
            'status': 'success',
            'message': 'All sessions terminated. You will be redirected to login.'
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/settings/auth-logs  → history for bar chart
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/auth-logs', methods=['GET'])
@login_required
def get_auth_logs():
    """Retrieve auth logs aggregated by day for the chart"""
    try:
        from models.models import UserAuthLog
        from datetime import datetime, timedelta
        
        # Last 15 days
        now_dt = datetime.utcnow()
        past_date = (now_dt - timedelta(days=14)).replace(hour=0, minute=0, second=0, microsecond=0)
        
        logs = getattr(current_user, 'auth_logs').filter(UserAuthLog.timestamp >= past_date).order_by(UserAuthLog.timestamp.asc()).all()
        
        # Aggregate by day
        from collections import defaultdict
        daily_login = defaultdict(int)
        daily_logout = defaultdict(int)
        
        for log in logs:
            day_str = log.timestamp.strftime('%Y-%m-%d')
            if log.action == 'login':
                daily_login[day_str] += 1
            elif log.action == 'logout':
                daily_logout[day_str] += 1
                
        # Generate last 15 days array
        categories = []
        logins_data = []
        logouts_data = []
        
        for i in range(15):
            day = past_date + timedelta(days=i)
            day_str = day.strftime('%Y-%m-%d')
            categories.append(day.strftime('%b %d'))
            logins_data.append(daily_login[day_str])
            logouts_data.append(daily_logout[day_str])
            
        return jsonify({
            'status': 'success',
            'data': {
                'categories': categories,
                'series': [
                    {'name': 'Logins', 'data': logins_data},
                    {'name': 'Logouts', 'data': logouts_data}
                ]
            }
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/settings/plan       → storage + analysis + redis status
# ─────────────────────────────────────────────────────────────────────────────
@settings_bp.route('/plan', methods=['GET'])
@login_required
def get_plan_data():
    """Real-time plan + usage + cache status for the Plan tab"""
    try:
        from services.cache_service import cache as cache_svc
        from models.models import UserAnalysisUsage, AnalysisLimit
        from datetime import date

        # ── Storage ──────────────────────────────────────────────────────────
        total_bytes = current_user.get_total_storage_limit_bytes()
        used_bytes  = current_user.used_storage_bytes or 0
        pct         = round((used_bytes / total_bytes) * 100, 1) if total_bytes > 0 else 0

        # ── Analysis quota ───────────────────────────────────────────────────
        today_usage = UserAnalysisUsage.query.filter_by(
            user_id=current_user.id,
            usage_date=date.today()
        ).first()
        used_analyses = today_usage.analysis_count if today_usage else 0

        # Get limit from plan
        plan_name   = current_user.user_type or 'Starter'
        limit_row   = AnalysisLimit.query.filter_by(plan_name=plan_name, is_active=True).first()
        daily_limit = limit_row.daily_analysis_limit if limit_row else 10

        # ── Redis status ──────────────────────────────────────────────────────
        redis_up, redis_latency = cache_svc.is_cache_available()

        # ── Subscription info ─────────────────────────────────────────────────
        trial_ends_str = None
        if current_user.is_on_trial and current_user.trial_ends_at:
            trial_ends_str = current_user.trial_ends_at.isoformat()

        sub_ends_str = None
        if current_user.subscription_ends_at:
            sub_ends_str = current_user.subscription_ends_at.isoformat()

        return jsonify({
            'status': 'success',
            'plan': {
                'name':                current_user.user_type or 'Starter',
                'is_trial':            current_user.is_on_trial,
                'trial_ends_at':       trial_ends_str,
                'subscription_status': current_user.subscription_status,
                'subscription_ends_at': sub_ends_str,
            },
            'storage': {
                'used_bytes':    used_bytes,
                'total_bytes':   total_bytes,
                'used_mb':       round(used_bytes / (1024 * 1024), 2),
                'total_mb':      round(total_bytes / (1024 * 1024), 2),
                'percentage':    pct,
            },
            'analysis': {
                'used_today':  used_analyses,
                'daily_limit': daily_limit,
                'remaining':   max(0, daily_limit - used_analyses),
            },
            'cache': {
                'status':     'up' if redis_up else 'down',
                'latency_ms': redis_latency if redis_latency is not None else -1,
            }
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
