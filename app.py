# ── eventlet monkey-patch: MUST be first — before any other import ────────────
import eventlet
# Patch only the modules needed by Flask-SocketIO.
# os/socket/select/thread are required; dns is intentionally excluded —
# eventlet's green DNS resolver fails on macOS (Errno 2 Lookup timed out).
eventlet.monkey_patch(os=True, socket=True, select=True, thread=True, time=True)
# ──────────────────────────────────────────────────────────────────────────────

from flask import Flask, redirect, url_for, render_template, request, jsonify, session, flash, make_response
from settings.extensions import db, cache, limiter, minio_client, redis_client, mail, login_manager, csrf, socketio
from settings.config import Config
from flask_login import login_user, logout_user, login_required, current_user
from datetime import timedelta
import os
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# Refreshed for session_metadata support

# Cargar configuración
app.config.from_object(Config['default'])

# Configuración de sesión
# Secret key is loaded from Config object in line 16
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_SECURE'] = False  # True en producción con HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Inicializar extensiones
db.init_app(app)
cache.init_app(app)
limiter.init_app(app)
mail.init_app(app)
login_manager.init_app(app)
csrf.init_app(app)
socketio.init_app(app)

# Registrar blueprint de notificaciones + eventos SocketIO
from routes.notifications_routes import notifications_bp, register_socketio_events
app.register_blueprint(notifications_bp)
register_socketio_events(socketio)

# Registrar blueprint de colaboradores + eventos SocketIO de sala de documento
from routes.collaborators_routes import collaborators_bp, register_doc_socketio_events
app.register_blueprint(collaborators_bp)
register_doc_socketio_events(socketio)

# Registrar blueprint de comentarios inline
from routes.comments_routes import comments_bp
app.register_blueprint(comments_bp)

# Registrar blueprint de tracking de contribuciones
from routes.contributions_routes import contributions_bp
app.register_blueprint(contributions_bp)

# Registrar blueprint de secciones de documentos
from routes.sections_routes import sections_bp
app.register_blueprint(sections_bp)

# Registrar blueprints existentes
from routes.document_routes import document_bp
from routes.share_routes import share_bp
from routes.upload_routes import upload_bp
from routes.users_routes import users_bp
from routes.routes_integrations import x_integ
from routes.workspace_routes import workspace_bp
from routes.folder_routes import folder_bp
from routes.settings_routes import settings_bp

app.register_blueprint(document_bp)
app.register_blueprint(share_bp, url_prefix='/share_bp')
app.register_blueprint(upload_bp, url_prefix='/upload_bp')
app.register_blueprint(users_bp)
app.register_blueprint(x_integ)  # Cloud storage integrations
app.register_blueprint(workspace_bp)  # Collaborative workspaces
app.register_blueprint(folder_bp)  # Folder CRUD API
app.register_blueprint(settings_bp) # Settings API
from routes.storage_routes import storage_bp
app.register_blueprint(storage_bp, url_prefix='/api/storage')

from routes.cache_routes import cache_bp
app.register_blueprint(cache_bp)

# ─────────────────────────────────────────────────────────────────────────────
# AUTENTICACIÓN — FUENTE DE VERDAD ÚNICA
# routes/auth_routes.py es el único módulo de auth activo.
# routes/auth_routes_fixed.py fue eliminado (era un borrador desconectado).
# ─────────────────────────────────────────────────────────────────────────────
from routes.auth_routes import auth_bp
app.register_blueprint(auth_bp, url_prefix='/auth_bp')

from routes.metrics_routes import metrics_bp
app.register_blueprint(metrics_bp)

# ── Student workspace portal (isolated auth domain) ───────────────────────────
from routes.student_routes import student_bp
app.register_blueprint(student_bp)
csrf.exempt(student_bp)  # CSRF handled via header X-CSRFToken in fetch() calls

# ── Extension Request (prórroga) ──────────────────────────────────────────────
from routes.extension_routes import extension_bp
app.register_blueprint(extension_bp)
csrf.exempt(extension_bp)  # Students use session-auth, CSRF via X-CSRFToken header

# ── Analysis Quota Counter ────────────────────────────────────────────────────
from routes.analysis_counter_routes import x_analysiscounter
app.register_blueprint(x_analysiscounter, url_prefix='/x_analysiscounter')

# ── Internet Paste Detection ──────────────────────────────────────────────────
from routes.plagiarism_routes import plagiarism_bp
from models.paste_evidence import PastedInternetContent  # noqa: F401 — imported to register model
app.register_blueprint(plagiarism_bp)
# Ensure the pasted_internet_content table is created if it doesn't exist
with app.app_context():
    try:
        db.create_all()
        logger.info('[App] pasted_internet_content table ensured via db.create_all()')
    except Exception as _e:
        logger.warning('[App] db.create_all() warning: %s', _e)


# ============================================================================
# RUTAS PRINCIPALES DE AUTENTICACIÓN (Sin prefijo)
# ============================================================================

@app.route('/')
def index():
    """Ruta principal - requiere autenticación"""
    if current_user.is_authenticated:
        return render_template('sections/home.html')
    return redirect(url_for('auth_bp.login'))


@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de salud para el HEALTHCHECK de Docker / Kubernetes"""
    return jsonify({
        'status': 'healthy',
        'app': 'XplagiaX MarkTrack'
    }), 200


# ── SIDEBAR SHARED COUNTS ─────────────────────────────────────────────────────
@app.route('/api/home/shared-counts', methods=['GET'])
@login_required
def home_shared_counts():
    """
    Retorna los contadores de compartición para los filtros del sidebar.

    Respuesta:
        shared_to_me_count  — docs/folders que OTROS me compartieron a mí.
        shared_with_count   — docs/folders que YO compartí con otros.
    """
    from models.models import Document, DocumentShare, Folder, FolderShare
    try:
        uid = current_user.id

        # ── Shared TO me (yo soy destinatario del share) ──────────────────────
        shared_to_me_docs = (
            DocumentShare.query
            .filter_by(user_id=uid, is_active=True)
            .join(Document)
            .filter(Document.is_deleted == False)
            .count()
        )
        shared_to_me_folders = (
            FolderShare.query
            .filter_by(user_id=uid, is_active=True)
            .count()
        )

        # ── Shared BY me (yo soy propietario y compartí con otros) ───────────
        shared_by_me_docs = (
            DocumentShare.query
            .join(Document)
            .filter(
                Document.owner_id == uid,
                DocumentShare.is_active == True,
                Document.is_deleted == False,
            )
            .count()
        )
        # Folder uses user_id as owner FK (not owner_id)
        shared_by_me_folders = (
            FolderShare.query
            .join(Folder, FolderShare.folder_id == Folder.id)
            .filter(
                Folder.user_id == uid,
                FolderShare.is_active == True,
                Folder.is_deleted == False,
            )
            .count()
        )

        return jsonify({
            'shared_to_me_count': shared_to_me_docs + shared_to_me_folders,
            'shared_with_count':  shared_by_me_docs  + shared_by_me_folders,
        })
    except Exception as e:
        logger.error(f"[home_shared_counts] Error: {e}")
        return jsonify({'shared_to_me_count': 0, 'shared_with_count': 0})
# ─────────────────────────────────────────────────────────────────────────────
 
@app.route('/logout', strict_slashes=False)
@login_required
def logout_page():
    """Cerrar sesión"""
    if current_user.is_authenticated:
        from models.models import UserAuthLog
        from flask import request
        current_user.invalidate_session()
        log_instance = UserAuthLog(
            user_id=current_user.id,
            action='logout',
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string
        )
        db.session.add(log_instance)
        db.session.commit()
    logout_user()
    session.clear()
    flash('Sesión cerrada correctamente', 'success')
    return redirect(url_for('auth_bp.login'))


# ============================================================================
# CREAR TABLAS Y DATOS INICIALES
# ============================================================================

@app.before_request
def log_request_info():
    try:
        with open("requests_debug.log", "a") as f:
            f.write(f"REQUEST: {request.method} {request.url}\n")
    except:
        pass

@app.before_request
def create_tables():
    """Create tables on first request"""
    app.before_request_funcs[None].remove(create_tables)
    with app.app_context():
        db.create_all()
        from models.models import StoragePlan
        StoragePlan.create_default_plans()
        logger.info("Database tables created")


def create_seaweedfs_buckets():
    """Crear buckets (directorios) de SeaweedFS si no existen"""
    BUCKETS = ['documents', 'images', 'exports', 'backups', 'uploads']
    for bucket in BUCKETS:
        try:
            if not minio_client.bucket_exists(bucket):
                minio_client.make_bucket(bucket)
                logger.info(f"Bucket {bucket} creado en SeaweedFS")
        except Exception as e:
            logger.error(f"Error creando bucket {bucket}: {e}")

# Alias para compatibilidad
create_minio_buckets = create_seaweedfs_buckets

# Iniciar worker de sincronización de archivos (Local -> SeaweedFS)
if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.config.get('DEBUG'):
    try:
        from services.storage_sync import StorageSyncWorker
        StorageSyncWorker.start(app)
    except Exception as e:
        logger.info(f"SyncWorker not started: {e}")

if __name__ == '__main__':
    # socketio.run() reemplaza app.run() para que eventlet maneje WebSockets.
    # El resto del comportamiento (debug, host, port) es idéntico.
    socketio.run(app, debug=True, host='0.0.0.0', port=5002)