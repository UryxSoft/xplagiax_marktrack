# auth_routes.py — Rutas de autenticación para XplagiaX MarkTrack
# FUENTE DE VERDAD ÚNICA: Este es el archivo oficial de autenticación.
# auth_routes_fixed.py fue eliminado — toda la lógica vive aquí.
import os
import re
from flask import (
    Blueprint, request, jsonify, session, url_for, redirect,
    render_template, current_app, g, flash, make_response
)
from flask_wtf.csrf import validate_csrf
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, BooleanField, validators
from settings.extensions import db
from models.models import User, StoragePlan, UserAuthLog
from flask_login import login_user, logout_user, login_required, current_user
import bcrypt
from .google_oauth import GoogleOAuth
from .microsoft_oauth import MicrosoftOAuth
from datetime import datetime, timedelta
import secrets
from functools import wraps

auth_bp = Blueprint('auth_bp', __name__, template_folder='../templates')

# Instancias de servicio OAuth
google_oauth = GoogleOAuth()
microsoft_oauth = MicrosoftOAuth()

# ─────────────────────────────────────────────
# Rate limiting básico (en producción: Flask-Limiter)
# ─────────────────────────────────────────────
_rate_limit_storage = {}


def rate_limit(max_requests=5, window_minutes=15, methods=None):
    """Decorador de rate limiting básico con filtro opcional por método HTTP."""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if methods and request.method not in methods:
                return f(*args, **kwargs)

            key = f"{request.remote_addr}:{f.__name__}"
            now = datetime.utcnow()
            cutoff = now - timedelta(minutes=window_minutes)

            _rate_limit_storage.setdefault(key, [])
            _rate_limit_storage[key] = [t for t in _rate_limit_storage[key] if t > cutoff]

            if len(_rate_limit_storage[key]) >= max_requests:
                return jsonify({'error': 'Too many attempts. Please try again later.'}), 429

            _rate_limit_storage[key].append(now)
            return f(*args, **kwargs)
        return wrapped
    return decorator


# ─────────────────────────────────────────────
# Formularios WTForms (protección CSRF)
# ─────────────────────────────────────────────
class LoginForm(FlaskForm):
    email = StringField('Email', [validators.Email(), validators.DataRequired()])
    password = PasswordField('Password', [validators.DataRequired()])
    remember_me = BooleanField('Remember Me')





# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
def validate_email_domain(email):
    """Placeholder para lista blanca de dominios (implementar si es necesario)."""
    return True


def sanitize_redirect_url(url):
    """Valida que la URL de redirect sea segura (relativa, no API endpoint)."""
    if not url:
        return url_for('users.home')
    if url.startswith('/') and not url.startswith('//'):
        blocked_prefixes = ('/api/', '/share_bp/api/', '/api/')
        if any(url.startswith(p) for p in blocked_prefixes):
            return url_for('users.home')
        return url
    return url_for('users.home')


# ─────────────────────────────────────────────
# GOOGLE OAUTH
# ─────────────────────────────────────────────

@auth_bp.route("/google/login")
def google_login():
    """Inicia el flujo de autenticación con Google."""
    next_url = request.args.get('next', url_for('users.home'))
    session['oauth_next'] = next_url
    auth_url = google_oauth.get_authorization_url()
    current_app.logger.info("[OAuth][Google] Flujo iniciado → redirigiendo a Google")
    return redirect(auth_url)


@auth_bp.route("/google/callbackx")
def google_callback():
    """Callback de Google OAuth — intercambia code por token y loguea al usuario."""
    from flask import session as flask_session

    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')

    current_app.logger.info(
        "[OAuth][Google] Callback recibido: code=%s state=%s error=%s",
        bool(code), bool(state), error
    )

    if error:
        current_app.logger.warning("[OAuth][Google] Proveedor devolvió error: %s", error)
        flash(f'Google authorization error: {error}', 'error')
        return redirect(url_for('auth_bp.login'))

    if not code or not state:
        current_app.logger.warning("[OAuth][Google] Parámetros inválidos — code o state ausentes")
        flash('Invalid authorization parameters', 'error')
        return redirect(url_for('auth_bp.login'))

    try:
        # 1. Intercambiar código por datos de usuario
        user_data, error_msg = google_oauth.exchange_code_for_user_data(code, state)
        if error_msg:
            current_app.logger.error("[OAuth][Google] Error al intercambiar código: %s", error_msg)
            flash(f'Authentication error: {error_msg}', 'error')
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info("[OAuth][Google] Token obtenido correctamente")

        email = user_data.get('email', '').lower().strip()
        if not email:
            current_app.logger.error("[OAuth][Google] No se obtuvo email del token")
            flash("Could not retrieve email from Google account", "error")
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info("[OAuth][Google] Email del usuario: %s", email)

        # 2. Buscar o crear usuario
        user = User.query.filter_by(email=email).first()
        is_new_user = False

        if not user:
            current_app.logger.info("[OAuth][Google] Creando nuevo usuario: %s", email)
            plan_starter = StoragePlan.query.filter_by(name="Starter").first()
            user = User(
                email=email,
                name=user_data.get('name', ''),
                confirmed=True,
                isactive=True,
                user_type="Starter",
                storage_plan_id=plan_starter.id if plan_starter else None,
                oauth_provider='google',
                oauth_id=str(user_data.get('id', '')),
                avatar=user_data.get('picture'),
                confirmed_at=datetime.utcnow()
            )
            db.session.add(user)
            db.session.flush()  # Obtiene el ID antes del commit
            is_new_user = True
        else:
            current_app.logger.info("[OAuth][Google] Usuario existente encontrado: %s", email)
            if user_data.get('picture'):
                user.avatar = user_data.get('picture')
            if not user.isactive:
                user.isactive = True
            if not user.confirmed:
                user.confirmed = True
                user.confirmed_at = datetime.utcnow()
            if not user.oauth_provider:
                user.oauth_provider = 'google'
                user.oauth_id = str(user_data.get('id', ''))

        db.session.commit()
        current_app.logger.info("[OAuth][Google] Usuario ID=%s guardado en DB", user.id)

        # 3. Preparar sesión y login
        flask_session.clear()
        flask_session.permanent = True

        # Verificar que el user_loader funciona antes de llamar login_user
        loaded_user = current_app.login_manager._user_callback(str(user.id))
        if not loaded_user:
            current_app.logger.error("[OAuth][Google] CRÍTICO: user_loader falla para ID=%s", user.id)
            flash("Authentication system error — please try again", "error")
            return redirect(url_for('auth_bp.login'))

        login_success = login_user(user, remember=True, fresh=True)
        current_app.logger.info("[OAuth][Google] login_user resultado: %s", login_success)
        
        if login_success:
            log_instance = UserAuthLog(
                user_id=user.id,
                action='login',
                ip_address=request.remote_addr,
                user_agent=request.user_agent.string
            )
            db.session.add(log_instance)

        if not login_success or not current_user.is_authenticated:
            current_app.logger.error("[OAuth][Google] CRÍTICO: login_user falló o current_user no autenticado")
            flash("Authentication error — please try again", "error")
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info(
            "[OAuth][Google] current_user autenticado: %s (ID=%s)",
            current_user.email, current_user.id
        )

        # 4. Sesión personalizada (token de sesión + backup)
        try:
            session_token = user.create_session()
            flask_session['session_token'] = session_token
            flask_session['user_id'] = user.id
            current_app.logger.info("[OAuth][Google] Sesión personalizada creada")
        except Exception as e:
            current_app.logger.warning("[OAuth][Google] Error creando sesión personalizada (no crítico): %s", e)

        db.session.commit()

        welcome_msg = f"Welcome {'back' if not is_new_user else ''}, {user.name or user.email}!"
        flash(welcome_msg, 'success')

        # 5. Redirect post-login
        next_url = flask_session.pop('oauth_next', None) or url_for('users.home')
        # Proteger contra redirect a raw API endpoints (causan 405)
        blocked = ('/api/', '/share_bp/api/', '/api/')
        if (not next_url.startswith(('http://', 'https://', '/'))
                or any(next_url.startswith(p) for p in blocked)):
            next_url = url_for('users.home')

        current_app.logger.info("[OAuth][Google] ✓ Login completado → redirigiendo a: %s", next_url)

        response = make_response(redirect(next_url))
        response.set_cookie('session_active', 'true', max_age=3600, httponly=False)
        return response

    except Exception:
        current_app.logger.exception("[OAuth][Google] EXCEPCIÓN en callback")
        db.session.rollback()
        flask_session.clear()
        flash("Internal error authenticating with Google. Please try again.", "error")
        return redirect(url_for('auth_bp.login'))


# ─────────────────────────────────────────────
# MICROSOFT OAUTH
# ─────────────────────────────────────────────

@auth_bp.route("/microsoft/login")
def microsoft_login():
    """Inicia el flujo de autenticación con Microsoft."""
    next_url = request.args.get('next', url_for('users.home'))
    session['oauth_next'] = next_url
    auth_url = microsoft_oauth.get_authorization_url()
    current_app.logger.info("[OAuth][Microsoft] Flujo iniciado → redirigiendo a Microsoft")
    return redirect(auth_url)


@auth_bp.route("/microsoft/callback")
def microsoft_callback():
    """Callback de Microsoft OAuth — intercambia code por token y loguea al usuario."""
    from flask import session as flask_session

    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    error_description = request.args.get('error_description')

    current_app.logger.info(
        "[OAuth][Microsoft] Callback recibido: code=%s state=%s error=%s",
        bool(code), bool(state), error
    )

    if error:
        current_app.logger.warning(
            "[OAuth][Microsoft] Proveedor devolvió error: %s — %s", error, error_description
        )
        flash(f'Microsoft error: {error_description or error}', 'error')
        return redirect(url_for('auth_bp.login'))

    if not code or not state:
        current_app.logger.warning("[OAuth][Microsoft] Parámetros inválidos — code o state ausentes")
        flash('Invalid authorization parameters', 'error')
        return redirect(url_for('auth_bp.login'))

    try:
        # 1. Intercambiar código por datos de usuario
        user_data, error_msg = microsoft_oauth.exchange_code_for_user_data(code, state)
        if error_msg:
            current_app.logger.error("[OAuth][Microsoft] Error al intercambiar código: %s", error_msg)
            flash(f'Authentication error: {error_msg}', 'error')
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info("[OAuth][Microsoft] Token obtenido correctamente")

        email = user_data.get('email', '').lower().strip()
        if not email:
            current_app.logger.error("[OAuth][Microsoft] No se obtuvo email del token")
            flash("Could not retrieve email from Microsoft account", "error")
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info("[OAuth][Microsoft] Email del usuario: %s", email)

        # 2. Buscar o crear usuario
        user = User.query.filter_by(email=email).first()
        is_new_user = False

        if not user:
            current_app.logger.info("[OAuth][Microsoft] Creando nuevo usuario: %s", email)
            plan_starter = StoragePlan.query.filter_by(name="Starter").first()
            user = User(
                email=email,
                name=user_data.get('name', ''),
                confirmed=True,
                isactive=True,
                user_type="Starter",
                storage_plan_id=plan_starter.id if plan_starter else None,
                oauth_provider='microsoft',
                oauth_id=str(user_data.get('id', '')),
                confirmed_at=datetime.utcnow()
            )
            db.session.add(user)
            db.session.flush()
            is_new_user = True

            # Intentar guardar foto de Microsoft (operación opcional, no bloquea el flujo)
            if user_data.get('access_token'):
                _save_microsoft_photo(user, user_data['access_token'])
        else:
            current_app.logger.info("[OAuth][Microsoft] Usuario existente encontrado: %s", email)
            if user_data.get('access_token'):
                _save_microsoft_photo(user, user_data['access_token'])
            if not user.isactive:
                user.isactive = True
            if not user.confirmed:
                user.confirmed = True
                user.confirmed_at = datetime.utcnow()
            if not user.oauth_provider:
                user.oauth_provider = 'microsoft'
                user.oauth_id = str(user_data.get('id', ''))

        db.session.commit()
        current_app.logger.info("[OAuth][Microsoft] Usuario ID=%s guardado en DB", user.id)

        # 3. Preparar sesión y login
        flask_session.clear()
        flask_session.permanent = True

        # Verificar que el user_loader funciona antes de llamar login_user
        loaded_user = current_app.login_manager._user_callback(str(user.id))
        if not loaded_user:
            current_app.logger.error("[OAuth][Microsoft] CRÍTICO: user_loader falla para ID=%s", user.id)
            flash("Authentication system error — please try again", "error")
            return redirect(url_for('auth_bp.login'))

        login_success = login_user(user, remember=True, fresh=True)
        current_app.logger.info("[OAuth][Microsoft] login_user resultado: %s", login_success)
        
        if login_success:
            log_instance = UserAuthLog(
                user_id=user.id,
                action='login',
                ip_address=request.remote_addr,
                user_agent=request.user_agent.string
            )
            db.session.add(log_instance)

        if not login_success or not current_user.is_authenticated:
            current_app.logger.error("[OAuth][Microsoft] CRÍTICO: login_user falló o current_user no autenticado")
            flash("Authentication error — please try again", "error")
            return redirect(url_for('auth_bp.login'))

        current_app.logger.info(
            "[OAuth][Microsoft] current_user autenticado: %s (ID=%s)",
            current_user.email, current_user.id
        )

        # 4. Sesión personalizada
        try:
            session_token = user.create_session()
            flask_session['session_token'] = session_token
            flask_session['user_id'] = user.id
            current_app.logger.info("[OAuth][Microsoft] Sesión personalizada creada")
        except Exception as e:
            current_app.logger.warning("[OAuth][Microsoft] Error creando sesión personalizada (no crítico): %s", e)

        db.session.commit()

        welcome_msg = f"Welcome {'back' if not is_new_user else ''} with Microsoft, {user.name or user.email}!"
        flash(welcome_msg, 'success')

        # 5. Redirect post-login
        next_url = flask_session.pop('oauth_next', None) or url_for('users.home')
        blocked = ('/api/', '/share_bp/api/', '/api/')
        if (not next_url.startswith(('http://', 'https://', '/'))
                or any(next_url.startswith(p) for p in blocked)):
            next_url = url_for('users.home')

        current_app.logger.info("[OAuth][Microsoft] ✓ Login completado → redirigiendo a: %s", next_url)

        response = make_response(redirect(next_url))
        response.set_cookie('session_active', 'true', max_age=3600, httponly=False)
        return response

    except Exception:
        current_app.logger.exception("[OAuth][Microsoft] EXCEPCIÓN en callback")
        db.session.rollback()
        flask_session.clear()
        flash("Internal error authenticating with Microsoft. Please try again.", "error")
        return redirect(url_for('auth_bp.login'))


def _save_microsoft_photo(user, access_token):
    """Helper: descarga y guarda la foto de perfil de Microsoft (sin lanzar excepciones)."""
    try:
        photo_content = microsoft_oauth.get_user_photo(access_token)
        if not photo_content:
            return
        photo_filename = f"ms_{user.id}.jpg"
        avatars_dir = os.path.join(current_app.root_path, 'static', 'img', 'avatars')
        os.makedirs(avatars_dir, exist_ok=True)
        photo_path = os.path.join(avatars_dir, photo_filename)
        with open(photo_path, 'wb') as f:
            f.write(photo_content)
        user.avatar = f"/static/img/avatars/{photo_filename}"
        current_app.logger.info("[OAuth][Microsoft] Foto guardada: %s", photo_filename)
    except Exception as e:
        current_app.logger.warning("[OAuth][Microsoft] Error guardando foto (no crítico): %s", e)


# ─────────────────────────────────────────────
# EMAIL/PASSWORD LOGIN
# ─────────────────────────────────────────────

@auth_bp.route('/login', methods=['GET', 'POST'])
@rate_limit(max_requests=30, window_minutes=15, methods=['POST'])
def login():
    if request.method == 'GET':
        if current_user.is_authenticated:
            return redirect(url_for('users.home'))
        return render_template('auth/login.html')

    # POST — soporta JSON y form data
    if request.is_json:
        data = request.get_json() or {}
        remember_me = data.get('remember_me', False)
    else:
        form = LoginForm()
        if not form.validate_on_submit():
            return jsonify({'error': 'Invalid data', 'errors': form.errors}), 400
        data = form.data
        remember_me = form.remember_me.data

    email = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        current_app.logger.info("[Login] Intento fallido — email no encontrado: %s", email)
        return jsonify({'error': 'Incorrect credentials'}), 401

    if not user.isactive:
        return jsonify({'error': 'Account not activated. Check your email.'}), 401

    if not user._password_hash:
        return jsonify({
            'error': 'This account was created with Google/Microsoft. Use the corresponding button.'
        }), 400

    if not bcrypt.checkpw(password.encode('utf-8'), user._password_hash.encode('utf-8')):
        current_app.logger.info("[Login] Contraseña incorrecta para: %s", email)
        return jsonify({'error': 'Incorrect credentials'}), 401

    # Crear sesión e iniciar login
    session_token = user.create_session()
    db.session.add(user)
    db.session.commit()

    session['session_token'] = session_token
    login_user(user, remember=remember_me)

    log_instance = UserAuthLog(
        user_id=user.id,
        action='login',
        ip_address=request.remote_addr,
        user_agent=request.user_agent.string
    )
    db.session.add(log_instance)
    db.session.commit()

    current_app.logger.info("[Login] ✓ Login exitoso para: %s", email)

    next_url = sanitize_redirect_url(request.args.get('next'))
    return jsonify({'message': 'Login successful', 'redirect': next_url}), 200


# ─────────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────────

@auth_bp.route('/logout')
@login_required
def logout():
    email = current_user.email if current_user.is_authenticated else 'unknown'
    if current_user.is_authenticated:
        current_user.invalidate_session()
        log_instance = UserAuthLog(
            user_id=current_user.id,
            action='logout',
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string
        )
        db.session.add(log_instance)
        db.session.add(current_user)
        db.session.commit()
    logout_user()
    session.clear()
    current_app.logger.info("[Auth] Logout para: %s", email)
    flash('Logged out successfully', 'success')
    return redirect(url_for('auth_bp.login'))


# ─────────────────────────────────────────────
# SIGNUP
# ─────────────────────────────────────────────

@auth_bp.route('/signup', methods=['GET', 'POST'])
def signup():
    """Signup is disabled in the UI. Redirecting to login."""
    if request.method == 'GET':
        return redirect(url_for('auth_bp.login'))
    
    return jsonify({'error': 'Registration is currently disabled. Please contact an administrator.'}), 403


# ─────────────────────────────────────────────
# PASSWORD RESET
# ─────────────────────────────────────────────

@auth_bp.route('/forgot-password', methods=['GET', 'POST'])
@rate_limit(max_requests=5, window_minutes=15, methods=['POST'])
def forgot_password():
    if request.method == 'GET':
        return render_template('auth/forgot_password.html')

    data = request.get_json() or request.form
    email = data.get('email', '').strip().lower()

    if not email:
        return jsonify({'error': 'Email required'}), 400

    # Siempre devolver successo para no revelar si el email existe
    return jsonify({
        'message': 'If the email exists in our system, you will receive a recovery link.'
    }), 200


@auth_bp.route('/reset-password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    if request.method == 'GET':
        return render_template('auth/reset_password.html', token=token)
    return jsonify({'message': 'Password reset not implemented yet'}), 501


# ─────────────────────────────────────────────
# MIDDLEWARE: Validación de sesión en cada request
# ─────────────────────────────────────────────

@auth_bp.before_app_request
def security_checks():
    """
    Valida la sesión en cada request:
    - Single-session enforcement: invalida si el token no coincide
    """
    g.session_invalidated = False

    if current_user.is_authenticated:
        try:
            stored_token = session.get('session_token')
            if not stored_token or not current_user.is_session_valid(stored_token):
                current_app.logger.warning(
                    "[Security] Sesión inválida para user ID=%s — forzando logout",
                    getattr(current_user, 'id', '?')
                )
                logout_user()
                session.clear()
                g.session_invalidated = True
                # Solo notificar si no es una ruta de auth (evitar flash en el login mismo)
                endpoint = request.endpoint or ''
                if not endpoint.startswith('auth_bp'):
                    flash('Your session has expired. Please log in again.', 'warning')
        except Exception:
            current_app.logger.exception("[Security] Error en validación de sesión")
            logout_user()
            session.clear()
            g.session_invalidated = True


# ─────────────────────────────────────────────
# ERROR HANDLERS
# ─────────────────────────────────────────────

@auth_bp.errorhandler(429)
def rate_limit_handler(e):
    return jsonify({'error': 'Too many attempts. Please try again later.'}), 429


@auth_bp.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Invalid request'}), 400
