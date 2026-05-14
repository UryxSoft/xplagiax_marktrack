from flask import Flask, request, session,Blueprint, redirect, url_for, jsonify, render_template
import json
import requests
import secrets
import hashlib
import base64
from urllib.parse import urlencode, quote
from datetime import datetime, timedelta
from models.models import User as Users
import os
from functools import wraps
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.exc import SQLAlchemyError
import ssl
import urllib3
from settings.config import Config
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry
from settings.config import DevelopmentConfig 

# Configurar SSL y requests para evitar problemas de handshake
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Crear tablas
x_integ = Blueprint('x_integ', __name__)

# Exempt from CSRF (uses login_required for security)
from settings.extensions import csrf
csrf.exempt(x_integ)

# Configuración de base de datos SQLAlchemy
DATABASE_URL = DevelopmentConfig.SQLALCHEMY_DATABASE_URI #'mysql+pymysql://root:@localhost/xplagiax_db'
# Para SQLite: DATABASE_URL = 'sqlite:///storage_integration.db'
# Para PostgreSQL: DATABASE_URL = 'postgresql://user:password@localhost/dbname'
# Configuración OAuth para cada proveedor
OAUTH_CONFIG = {
    'onedrive': {
        'client_id': 'bdf2666a-3055-423c-a97c-ff98fd098f77',
        'client_secret': '9aae517d-2322-496c-bbed-a00501aa379b',
        'authorization_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'token_url': 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        'scope': 'https://graph.microsoft.com/Files.ReadWrite offline_access',
        'api_base': 'https://graph.microsoft.com/v1.0'
    },
    'google_drive': {
        'client_id': '121671119534-92uo2m1vpju3m3msh74jcf389nqhif4r.apps.googleusercontent.com',
        'client_secret': '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',
        'authorization_url': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token_url': 'https://oauth2.googleapis.com/token',
        'scope': 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
        'api_base': 'https://www.googleapis.com/drive/v3'
    },
    'dropbox': {
        'client_id': 'uksuctfs3bvxl9o',
        'client_secret': 'ohsz9unjmmbi6t0',
        'authorization_url': 'https://www.dropbox.com/oauth2/authorize',
        'token_url': 'https://api.dropboxapi.com/oauth2/token',
        'scope': 'account_info.read files.metadata.read files.content.read files.content.write',
        'api_base': 'https://api.dropboxapi.com/2'
    },
    'box': {
        'client_id': '2exf4vhqo7jozfhrxt3grl885ltm36c1',
        'client_secret': 'Jdgzvg5HExQAnupFNYzGXmdUQNrwrhsf',
        'authorization_url': 'https://account.box.com/api/oauth2/authorize',
        'token_url': 'https://api.box.com/oauth2/token',
        'scope': 'root_readwrite',
        'api_base': 'https://api.box.com/2.0'
    }
}

# Database session
engine = create_engine(DATABASE_URL, echo=False)
db_session = scoped_session(sessionmaker(bind=engine))
Base = declarative_base()

# Configurar adaptador HTTP con reintentos y configuración SSL mejorada
def create_requests_session():
    """Crear sesión de requests con configuración SSL optimizada"""
    sess = requests.Session()
    
    # Configurar reintentos
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    
    adapter = HTTPAdapter(max_retries=retry_strategy)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    
    # Headers para evitar problemas de user-agent
    sess.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })
    
    return sess

# Crear sesión global HTTP
http_session = create_requests_session()

def make_secure_request(method, url, **kwargs):
    """Realizar petición HTTP con manejo mejorado de SSL"""
    try:
        response = http_session.request(method, url, **kwargs)
        return response
    except requests.exceptions.SSLError as e:
        print(f"SSL Error con método 1: {e}")
        try:
            kwargs['verify'] = False
            response = requests.request(method, url, **kwargs)
            print("Warning: SSL verification disabled for this request")
            return response
        except Exception as e2:
            print(f"Error con método 2: {e2}")
            raise e

def login_required(f):
    """Decorador para verificar autenticación"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

def get_user_tokens(user_id):
    """Obtener tokens del usuario desde la base de datos"""
    try:
        user = db_session.query(Users).filter_by(id=user_id).first()
        
        if user and user.tokens:
            return json.loads(user.tokens)
        return {}
    except SQLAlchemyError as e:
        print(f"Error obteniendo tokens: {e}")
        db_session.rollback()
        return {}

def save_user_tokens(user_id, tokens):
    """Guardar tokens del usuario en la base de datos"""
    try:
        user = db_session.query(Users).filter_by(id=user_id).first()
        
        if user:
            user.tokens = json.dumps(tokens)
            user.updated_at = datetime.utcnow()
            db_session.commit()
            return True
        else:
            print(f"Usuario con ID {user_id} no encontrado")
            return False
    except SQLAlchemyError as e:
        print(f"Error guardando tokens: {e}")
        db_session.rollback()
        return False

def create_user(username, email):
    """Crear un nuevo usuario"""
    try:
        user = Users(username=username, email=email)
        db_session.add(user)
        db_session.commit()
        return user.id
    except SQLAlchemyError as e:
        print(f"Error creando usuario: {e}")
        db_session.rollback()
        return None

def get_user_by_id(user_id):
    """Obtener usuario por ID"""
    try:
        return db_session.query(Users).filter_by(id=user_id).first()
    except SQLAlchemyError as e:
        print(f"Error obteniendo usuario: {e}")
        return None
    
# Función específica para cada proveedor
def filter_documents_by_provider(files, provider):
    """Filtrar documentos considerando las particularidades de cada proveedor"""
    
    document_extensions = {'.pdf', '.doc', '.docx', '.txt', '.epub', '.ppt', '.pptx', '.rtf', '.mobi'}
    
    # MIME types específicos por proveedor
    provider_mime_types = {
        'google_drive': {
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.google-apps.document',  # Google Docs
            'application/vnd.google-apps.presentation',  # Google Slides
            'application/rtf',
            'text/rtf'
        },
        'dropbox': {
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/rtf',
            'text/rtf'
        },
        'box': {
            'file',  # Box usa 'file' como tipo genérico
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/rtf'
        },
        'onedrive': {
             'file',  # Yandex usa 'file' como tipo genérico
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        }
    }
    
    allowed_mime_types = provider_mime_types.get(provider, set())
    filtered_files = []
    
    for file in files:
        is_document = False
        
        # Verificar por extensión (principal método para pCloud, Yandex, MEGA)
        if 'name' in file and file['name']:
            file_name = file['name'].lower()
            if any(file_name.endswith(ext) for ext in document_extensions):
                is_document = True
        
        # Verificar por MIME type (más preciso para Google Drive y Dropbox)
        if 'type' in file and file['type']:
            if file['type'] in allowed_mime_types:
                is_document = True
                
        # Caso especial para proveedores que usan 'file' genérico
        if provider in ['box', 'pcloud', 'yandex', 'mega']:
            if 'type' in file and file['type'] == 'file':
                # Para estos proveedores, si es 'file', verificar extensión
                if 'name' in file and file['name']:
                    file_name = file['name'].lower()
                    if any(file_name.endswith(ext) for ext in document_extensions):
                        is_document = True
        
        if is_document:
            filtered_files.append(file)
    
    return filtered_files

@x_integ.route('/storage/connect/<provider>')
@login_required
def connect_storage(provider):
    """Iniciar proceso de OAuth para un proveedor"""
    if provider not in OAUTH_CONFIG:
        return jsonify({'error': 'Proveedor no soportado'}), 400
    
    if provider == 'mega':
        return jsonify({'error': 'MEGA requiere credenciales directas'}), 400
    
    config = OAUTH_CONFIG[provider]
    
    # Generar state para seguridad
    state = secrets.token_urlsafe(32)
    session[f'{provider}_state'] = state
    session[f'{provider}_provider'] = provider
    
    # Parámetros OAuth
    params = {
        'client_id': config['client_id'],
        'response_type': 'code',
        'redirect_uri': url_for('x_integ.oauth_callback', provider=provider, _external=True),
        'state': state,
        'access_type': 'offline'  # Para refresh token
    }
    
    # Agregar scope si existe
    if 'scope' in config:
        params['scope'] = config['scope']
    
    # URL de autorización
    auth_url = f"{config['authorization_url']}?{urlencode(params)}"
    
    return redirect(auth_url)

@x_integ.route('/storage/callback/<provider>')
@login_required
def oauth_callback(provider):
    """Manejar callback de OAuth"""
    if provider not in OAUTH_CONFIG:
        return jsonify({'error': 'Proveedor no soportado'}), 400
    
    # Debug: Verificar valores de state
    received_state = request.args.get('state')
    session_state = session.get(f'{provider}_state')
    
    print(f"DEBUG - Received state: {received_state}")
    print(f"DEBUG - Session state: {session_state}")
    print(f"DEBUG - Session keys: {list(session.keys())}")
    
    # Verificar state (recomendado para seguridad)
    # Temporalmente deshabilitado para debugging
    # if not received_state or received_state != session_state:
    #     return jsonify({
    #         'error': 'Estado OAuth inválido',
    #         'received_state': received_state,
    #         'session_state': session_state
    #     }), 400
    
    # Obtener código de autorización
    code = request.args.get('code')
    if not code:
        return jsonify({'error': 'Código de autorización no recibido'}), 400
    
    config = OAUTH_CONFIG[provider]
    
    # Intercambiar código por tokens
    token_data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': url_for('x_integ.oauth_callback', provider=provider, _external=True),
        'client_id': config['client_id'],
        'client_secret': config['client_secret']
    }
    
    try:
        print(f"DEBUG - Making token request to: {config['token_url']}")
        print(f"DEBUG - Token data: {token_data}")
        
        # Usar función con manejo mejorado de SSL
        response = make_secure_request('POST', config['token_url'], data=token_data)
        response.raise_for_status()
        tokens = response.json()
        
        print(f"DEBUG - Received tokens: {tokens}")
        
        # Para pruebas, crear un user_id temporal si no existe en session
        if 'user_id' not in session:
            session['user_id'] = 1  # ID temporal para pruebas
        
        # Obtener tokens existentes del usuario
        user_tokens = get_user_tokens(session['user_id'])
        
        # Agregar nuevos tokens
        user_tokens[provider] = {
            'access_token': tokens['access_token'],
            'refresh_token': tokens.get('refresh_token'),
            'expires_at': (datetime.now() + timedelta(seconds=tokens.get('expires_in', 3600))).isoformat(),
            'connected_at': datetime.now().isoformat()
        }
        
        # Guardar en base de datos
        if save_user_tokens(session['user_id'], user_tokens):
            # Limpiar session
            session.pop(f'{provider}_state', None)
            session.pop(f'{provider}_provider', None)
            
            # Redirigir al módulo de documentos con el proveedor conectado
            return redirect('/documents?connected=' + provider)
        else:
            return jsonify({'error': 'Error guardando tokens'}), 500
            
    except requests.RequestException as e:
        print(f"Error en OAuth callback: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response status: {e.response.status_code}")
            print(f"Response text: {e.response.text}")
        return jsonify({'error': f'Error obteniendo tokens: {str(e)}'}), 500

@x_integ.route('/storage/disconnect/<provider>', methods=['GET', 'POST'])
@login_required
def disconnect_storage(provider):
    """Desconectar un proveedor de almacenamiento"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    
    if provider in user_tokens:
        del user_tokens[provider]
        
        if save_user_tokens(session['user_id'], user_tokens):
            return jsonify({'success': True, 'message': f'{provider} desconectado'})
        else:
            return jsonify({'error': 'Error desconectando proveedor'}), 500
    
    return jsonify({'error': 'Proveedor no encontrado'}), 404

@x_integ.route('/storage/connected')
@login_required
def get_connected_storages():
    """Obtener lista de proveedores conectados"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    
    connected = []
    for provider, token_data in user_tokens.items():
        connected.append({
            'provider': provider,
            'connected_at': token_data.get('connected_at'),
            'name': get_provider_display_name(provider)
        })
    
    return jsonify({'connected_storages': connected})

@x_integ.route('/storage/files/<provider>/shared/<file_id>')
@login_required
def get_shared_users(provider, file_id):
    """Obtener lista de usuarios con los que se ha compartido un archivo"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
        
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
        
    try:
        shared_users = fetch_shared_users_from_provider(provider, file_id, token_info['access_token'])
        return jsonify({'shared_users': shared_users})
    except Exception as e:
        print(f"Error obteniendo usuarios compartidos de {provider}: {e}")
        return jsonify({'error': str(e)}), 500

def fetch_shared_users_from_provider(provider, file_id, access_token):
    """Obtener usuarios compartidos según el proveedor"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    if provider == 'google_drive':
        # Google Drive usa permissions API
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/permissions"
        params = {'fields': 'permissions(id,displayName,emailAddress,role,photoLink)'}
        response = make_secure_request('GET', url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        
        return [
            {
                'id': p.get('id'),
                'name': p.get('displayName'),
                'email': p.get('emailAddress'),
                'role': p.get('role', 'viewer').capitalize(),
                'avatar': p.get('photoLink')
            }
            for p in data.get('permissions', [])
            if p.get('role') != 'owner' # Opcional: filtrar dueño si se prefiere
        ]
        
    elif provider == 'dropbox':
        # Dropbox usa sharing/list_file_members
        headers['Content-Type'] = 'application/json'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/list_file_members"
        payload = {"file": file_id, "include_inherited": True}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        data = response.json()
        
        users = []
        # Dropbox separa usuarios directos y grupos
        for u in data.get('users', []):
            profile = u.get('user', {})
            users.append({
                'id': profile.get('account_id'),
                'name': profile.get('display_name'),
                'email': profile.get('email'),
                'role': u.get('access_type', {}).get('.tag', 'viewer').capitalize()
            })
        return users
        
    elif provider == 'box':
        # Box usa collaborations
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/collaborations"
        response = make_secure_request('GET', url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        return [
            {
                'id': c.get('id'),
                'name': c.get('accessible_by', {}).get('name'),
                'email': c.get('accessible_by', {}).get('login'),
                'role': c.get('role', 'viewer').capitalize()
            }
            for c in data.get('entries', [])
        ]
        
    elif provider == 'onedrive':
        # OneDrive usa permissions
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/permissions"
        response = make_secure_request('GET', url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        users = []
        for p in data.get('value', []):
            # OneDrive maneja identidades sutilmente diferente
            invitation = p.get('grantedToV2', p.get('grantedTo', {}))
            user_info = invitation.get('user', invitation.get('siteUser', {}))
            if user_info:
                users.append({
                    'id': p.get('id'),
                    'name': user_info.get('displayName'),
                    'email': user_info.get('email'),
                    'role': p.get('roles', ['viewer'])[0].capitalize()
                })
        return users
        
    return []

# ============================================================
# CLOUD SHARING ENDPOINTS
# ============================================================

@x_integ.route('/storage/share/<provider>', methods=['POST'])
@login_required
def share_cloud_item(provider):
    """Compartir archivo o carpeta con un usuario"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    email = data.get('email', '').strip()
    role = data.get('role', 'reader')  # reader, commenter, writer
    notify = data.get('notify', True)
    message = data.get('message', '')
    
    if not file_id or not email:
        return jsonify({'error': 'ID de archivo y email requeridos'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_share_item(provider, token_info['access_token'], file_id, email, role, notify, message)
        return jsonify(result)
    except Exception as e:
        print(f"Error compartiendo en {provider}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@x_integ.route('/storage/unshare/<provider>', methods=['POST'])
@login_required
def unshare_cloud_item(provider):
    """Revocar acceso de un usuario a un archivo"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    permission_id = data.get('permission_id')
    email = data.get('email')  # Alternative to permission_id
    
    if not file_id or (not permission_id and not email):
        return jsonify({'error': 'ID de archivo y permission_id o email requeridos'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_unshare_item(provider, token_info['access_token'], file_id, permission_id, email)
        return jsonify(result)
    except Exception as e:
        print(f"Error revocando acceso en {provider}: {e}")
        return jsonify({'error': str(e)}), 500


@x_integ.route('/storage/link/<provider>', methods=['POST'])
@login_required
def create_public_link(provider):
    """Crear enlace público para un archivo"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    expires_at = data.get('expires_at')  # ISO date string, optional
    password = data.get('password')  # Optional, if provider supports
    
    if not file_id:
        return jsonify({'error': 'ID de archivo requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_create_public_link(provider, token_info['access_token'], file_id, expires_at, password)
        return jsonify(result)
    except Exception as e:
        print(f"Error creando enlace público en {provider}: {e}")
        return jsonify({'error': str(e)}), 500


@x_integ.route('/storage/link/<provider>/<file_id>', methods=['DELETE'])
@login_required
def delete_public_link(provider, file_id):
    """Eliminar enlace público de un archivo"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_delete_public_link(provider, token_info['access_token'], file_id)
        return jsonify(result)
    except Exception as e:
        print(f"Error eliminando enlace público en {provider}: {e}")
        return jsonify({'error': str(e)}), 500


# ============================================================
# CLOUD SHARING HELPER FUNCTIONS
# ============================================================

def cloud_share_item(provider, access_token, file_id, email, role='reader', notify=True, message=''):
    """Compartir archivo con un usuario por email"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/permissions"
        # Map roles: reader, commenter, writer
        payload = {
            'type': 'user',
            'role': role,
            'emailAddress': email
        }
        params = {'sendNotificationEmail': str(notify).lower()}
        if message:
            params['emailMessage'] = message
        
        response = make_secure_request('POST', url, headers=headers, json=payload, params=params)
        if response.status_code in [200, 201]:
            return {'success': True, 'permission_id': response.json().get('id')}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'dropbox':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/add_file_member"
        # Dropbox roles: viewer, editor
        dropbox_role = 'editor' if role == 'writer' else 'viewer'
        payload = {
            'file': file_id,
            'members': [{'member': {'.tag': 'email', 'email': email}, 'access_level': {'.tag': dropbox_role}}],
            'quiet': not notify,
            'custom_message': message if message else None
        }
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code == 200:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'box':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/collaborations"
        # Box roles: viewer, previewer, uploader, previewer_uploader, viewer_uploader, co-owner, owner, editor
        box_role = 'editor' if role == 'writer' else ('previewer' if role == 'commenter' else 'viewer')
        payload = {
            'item': {'type': 'file', 'id': file_id},
            'accessible_by': {'type': 'user', 'login': email},
            'role': box_role
        }
        params = {'notify': str(notify).lower()}
        
        response = make_secure_request('POST', url, headers=headers, json=payload, params=params)
        if response.status_code in [200, 201]:
            return {'success': True, 'collaboration_id': response.json().get('id')}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/invite"
        # OneDrive roles: read, write
        onedrive_roles = ['write'] if role == 'writer' else ['read']
        payload = {
            'requireSignIn': True,
            'sendInvitation': notify,
            'roles': onedrive_roles,
            'recipients': [{'email': email}],
            'message': message if message else None
        }
        
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code in [200, 201]:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    return {'success': False, 'error': 'Provider not supported'}


def cloud_unshare_item(provider, access_token, file_id, permission_id=None, email=None):
    """Revocar acceso de un usuario"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        if not permission_id:
            return {'success': False, 'error': 'permission_id required for Google Drive'}
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/permissions/{permission_id}"
        response = make_secure_request('DELETE', url, headers=headers)
        if response.status_code in [200, 204]:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'dropbox':
        if not email:
            return {'success': False, 'error': 'email required for Dropbox'}
        url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/remove_file_member_2"
        payload = {
            'file': file_id,
            'member': {'.tag': 'email', 'email': email}
        }
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code == 200:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'box':
        if not permission_id:
            return {'success': False, 'error': 'collaboration_id required for Box'}
        url = f"{OAUTH_CONFIG[provider]['api_base']}/collaborations/{permission_id}"
        response = make_secure_request('DELETE', url, headers=headers)
        if response.status_code in [200, 204]:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'onedrive':
        if not permission_id:
            return {'success': False, 'error': 'permission_id required for OneDrive'}
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/permissions/{permission_id}"
        response = make_secure_request('DELETE', url, headers=headers)
        if response.status_code in [200, 204]:
            return {'success': True}
        else:
            return {'success': False, 'error': response.text}
    
    return {'success': False, 'error': 'Provider not supported'}


def cloud_create_public_link(provider, access_token, file_id, expires_at=None, password=None):
    """Crear enlace público para un archivo"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        # Google Drive: create 'anyone' permission
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/permissions"
        payload = {
            'type': 'anyone',
            'role': 'reader'
        }
        if expires_at:
            payload['expirationTime'] = expires_at
        
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code in [200, 201]:
            # Get the web view link
            file_url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}"
            file_resp = make_secure_request('GET', file_url, headers={'Authorization': f'Bearer {access_token}'}, params={'fields': 'webViewLink'})
            link = file_resp.json().get('webViewLink', '') if file_resp.status_code == 200 else ''
            return {'success': True, 'link': link, 'permission_id': response.json().get('id')}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'dropbox':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/create_shared_link_with_settings"
        payload = {'path': file_id}
        settings = {}
        if expires_at:
            settings['expires'] = expires_at
        if password:
            settings['requested_visibility'] = {'.tag': 'password'}
            settings['link_password'] = password
        else:
            settings['requested_visibility'] = {'.tag': 'public'}
        
        if settings:
            payload['settings'] = settings
        
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code == 200:
            return {'success': True, 'link': response.json().get('url', '')}
        elif response.status_code == 409:
            # Link already exists, get it
            get_url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/list_shared_links"
            get_payload = {'path': file_id, 'direct_only': True}
            get_resp = make_secure_request('POST', get_url, headers=headers, json=get_payload)
            if get_resp.status_code == 200:
                links = get_resp.json().get('links', [])
                if links:
                    return {'success': True, 'link': links[0].get('url', '')}
            return {'success': False, 'error': 'Link already exists'}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'box':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}"
        shared_link = {'access': 'open'}
        if expires_at:
            shared_link['unshared_at'] = expires_at
        if password:
            shared_link['password'] = password
        
        payload = {'shared_link': shared_link}
        response = make_secure_request('PUT', url, headers=headers, json=payload)
        if response.status_code == 200:
            link_info = response.json().get('shared_link', {})
            return {'success': True, 'link': link_info.get('url', '')}
        else:
            return {'success': False, 'error': response.text}
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/createLink"
        payload = {'type': 'view', 'scope': 'anonymous'}
        if expires_at:
            payload['expirationDateTime'] = expires_at
        if password:
            payload['password'] = password
        
        response = make_secure_request('POST', url, headers=headers, json=payload)
        if response.status_code in [200, 201]:
            link = response.json().get('link', {}).get('webUrl', '')
            return {'success': True, 'link': link}
        else:
            return {'success': False, 'error': response.text}
    
    return {'success': False, 'error': 'Provider not supported'}


def cloud_delete_public_link(provider, access_token, file_id):
    """Eliminar enlace público de un archivo"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        # Find and delete 'anyone' permission
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/permissions"
        response = make_secure_request('GET', url, headers=headers)
        if response.status_code == 200:
            for perm in response.json().get('permissions', []):
                if perm.get('type') == 'anyone':
                    del_url = f"{url}/{perm.get('id')}"
                    make_secure_request('DELETE', del_url, headers=headers)
            return {'success': True}
        return {'success': False, 'error': response.text}
    
    elif provider == 'dropbox':
        # Revoke shared link
        url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/revoke_shared_link"
        # First get the link
        get_url = f"{OAUTH_CONFIG[provider]['api_base']}/sharing/list_shared_links"
        get_payload = {'path': file_id, 'direct_only': True}
        get_resp = make_secure_request('POST', get_url, headers=headers, json=get_payload)
        if get_resp.status_code == 200:
            links = get_resp.json().get('links', [])
            for link in links:
                revoke_payload = {'url': link.get('url')}
                make_secure_request('POST', url, headers=headers, json=revoke_payload)
            return {'success': True}
        return {'success': False, 'error': get_resp.text}
    
    elif provider == 'box':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}"
        payload = {'shared_link': None}
        response = make_secure_request('PUT', url, headers=headers, json=payload)
        if response.status_code == 200:
            return {'success': True}
        return {'success': False, 'error': response.text}
    
    elif provider == 'onedrive':
        # Get all permissions and delete link permissions
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/permissions"
        response = make_secure_request('GET', url, headers=headers)
        if response.status_code == 200:
            for perm in response.json().get('value', []):
                if perm.get('link'):
                    del_url = f"{url}/{perm.get('id')}"
                    make_secure_request('DELETE', del_url, headers=headers)
            return {'success': True}
        return {'success': False, 'error': response.text}
    
    return {'success': False, 'error': 'Provider not supported'}


@x_integ.route('/storage/files/<provider>')
@login_required
def get_storage_files(provider):
    """Obtener archivos de un proveedor específico"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    
    # Verificar si el token ha expirado
    if is_token_expired(token_info):
        # Intentar renovar token
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado, re-autenticación requerida'}), 401
        
        # Obtener tokens actualizados
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        all_files = fetch_files_from_provider(provider, token_info['access_token'])
        print(f"DEBUG - Total files from {provider}: {len(all_files)}")
        
        # Log some file info for debugging
        for f in all_files[:5]:  # First 5 files
            print(f"DEBUG - File: {f.get('name')} | Type: {f.get('type')}")
        
        # Filtrar solo documentos
        document_files = filter_documents_by_provider(all_files, provider)
        print(f"DEBUG - Filtered document files: {len(document_files)}")

        return jsonify({'files': document_files})
    except Exception as e:
        print(f"Error obteniendo archivos de {provider}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Error obteniendo archivos'}), 500

@x_integ.route('/storage/folder/<provider>')
@x_integ.route('/storage/folder/<provider>/<folder_id>')
@login_required
def get_storage_folder_content(provider, folder_id=None):
    """Obtener contenido de una carpeta específica en cloud storage (carpetas y archivos)"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    
    # Verificar si el token ha expirado
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado, re-autenticación requerida'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = fetch_folder_content(provider, token_info['access_token'], folder_id)
        return jsonify(result)
    except Exception as e:
        print(f"Error obteniendo carpeta de {provider}: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Error obteniendo contenido de carpeta'}), 500

# ============================================================
# CLOUD STORAGE FOLDER MANAGEMENT ENDPOINTS
# ============================================================

@x_integ.route('/storage/folder/create/<provider>', methods=['POST'])
@login_required
def create_cloud_folder(provider):
    """Crear nueva carpeta en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    folder_name = data.get('name', '').strip()
    parent_id = data.get('parent_id')  # None = root
    
    if not folder_name:
        return jsonify({'error': 'Nombre de carpeta requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_create_folder(provider, token_info['access_token'], folder_name, parent_id)
        return jsonify(result)
    except Exception as e:
        print(f"Error creando carpeta en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/folder/rename/<provider>', methods=['POST'])
@login_required
def rename_cloud_folder(provider):
    """Renombrar carpeta en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    folder_id = data.get('folder_id')
    new_name = data.get('new_name', '').strip()
    
    if not folder_id or not new_name:
        return jsonify({'error': 'ID y nuevo nombre requeridos'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_rename_item(provider, token_info['access_token'], folder_id, new_name, 'folder')
        return jsonify(result)
    except Exception as e:
        print(f"Error renombrando carpeta en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/folder/move/<provider>', methods=['POST'])
@login_required
def move_cloud_folder(provider):
    """Mover carpeta a otra ubicación en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    folder_id = data.get('folder_id')
    new_parent_id = data.get('new_parent_id')  # None = root
    
    if not folder_id:
        return jsonify({'error': 'ID de carpeta requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_move_item(provider, token_info['access_token'], folder_id, new_parent_id, 'folder')
        return jsonify(result)
    except Exception as e:
        print(f"Error moviendo carpeta en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/folder/delete/<provider>', methods=['POST'])
@login_required
def delete_cloud_folder(provider):
    """Eliminar carpeta en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    folder_id = data.get('folder_id')
    
    if not folder_id:
        return jsonify({'error': 'ID de carpeta requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_delete_item(provider, token_info['access_token'], folder_id, 'folder')
        return jsonify(result)
    except Exception as e:
        print(f"Error eliminando carpeta en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

# ============================================================
# CLOUD STORAGE FILE MANAGEMENT ENDPOINTS
# ============================================================

@x_integ.route('/storage/file/upload/<provider>', methods=['POST'])
@login_required
def upload_cloud_file(provider):
    """Subir archivo a cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    if 'file' not in request.files:
        return jsonify({'error': 'Archivo no proporcionado'}), 400
    
    file = request.files['file']
    parent_id = request.form.get('parent_id')  # None = root
    
    if not file.filename:
        return jsonify({'error': 'Nombre de archivo vacío'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_upload_file(provider, token_info['access_token'], file, parent_id)
        return jsonify(result)
    except Exception as e:
        print(f"Error subiendo archivo a {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/file/delete/<provider>', methods=['POST'])
@login_required
def delete_cloud_file(provider):
    """Eliminar archivo (mover a papelera) en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    
    if not file_id:
        return jsonify({'error': 'ID de archivo requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_delete_item(provider, token_info['access_token'], file_id, 'file')
        return jsonify(result)
    except Exception as e:
        print(f"Error eliminando archivo en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/file/restore/<provider>', methods=['POST'])
@login_required
def restore_cloud_file(provider):
    """Restaurar archivo de la papelera en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    
    if not file_id:
        return jsonify({'error': 'ID de archivo requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_restore_item(provider, token_info['access_token'], file_id)
        return jsonify(result)
    except Exception as e:
        print(f"Error restaurando archivo en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/file/download/<provider>/<file_id>')
@login_required
def download_cloud_file(provider, file_id):
    """Descargar archivo individual de cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        return cloud_download_file(provider, token_info['access_token'], file_id)
    except Exception as e:
        print(f"Error descargando archivo de {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/file/rename/<provider>', methods=['POST'])
@login_required
def rename_cloud_file(provider):
    """Renombrar archivo en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    new_name = data.get('new_name', '').strip()
    
    if not file_id or not new_name:
        return jsonify({'error': 'ID y nuevo nombre requeridos'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_rename_item(provider, token_info['access_token'], file_id, new_name, 'file')
        return jsonify(result)
    except Exception as e:
        print(f"Error renombrando archivo en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

@x_integ.route('/storage/file/move/<provider>', methods=['POST'])
@login_required
def move_cloud_file(provider):
    """Mover archivo a otra carpeta en cloud storage"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
    
    data = request.get_json()
    file_id = data.get('file_id')
    new_parent_id = data.get('new_parent_id')
    
    if not file_id:
        return jsonify({'error': 'ID de archivo requerido'}), 400
    
    user_tokens = get_user_tokens(session['user_id'])
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
    
    try:
        result = cloud_move_item(provider, token_info['access_token'], file_id, new_parent_id, 'file')
        return jsonify(result)
    except Exception as e:
        print(f"Error moviendo archivo en {provider}: {e}")
        return jsonify({'error': str(e)}), 500

def is_token_expired(token_info):
    """Verificar si un token ha expirado"""
    if 'expires_at' not in token_info:
        return False
    
    expires_at = datetime.fromisoformat(token_info['expires_at'])
    return datetime.now() >= expires_at

def refresh_access_token(user_id, provider):
    """Renovar access token usando refresh token"""
    if provider not in OAUTH_CONFIG:
        return False
    
    user_tokens = get_user_tokens(user_id)
    if provider not in user_tokens or 'refresh_token' not in user_tokens[provider]:
        return False
    
    config = OAUTH_CONFIG[provider]
    refresh_token = user_tokens[provider]['refresh_token']
    
    token_data = {
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': config['client_id'],
        'client_secret': config['client_secret']
    }
    
    try:
        response = make_secure_request('POST', config['token_url'], data=token_data)
        response.raise_for_status()
        tokens = response.json()
        
        # Actualizar tokens
        user_tokens[provider]['access_token'] = tokens['access_token']
        user_tokens[provider]['expires_at'] = (
            datetime.now() + timedelta(seconds=tokens.get('expires_in', 3600))
        ).isoformat()
        
        if 'refresh_token' in tokens:
            user_tokens[provider]['refresh_token'] = tokens['refresh_token']
        
        return save_user_tokens(user_id, user_tokens)
        
    except requests.RequestException as e:
        print(f"Error renovando token para {provider}: {e}")
        return False

# ============================================================
# CLOUD STORAGE HELPER FUNCTIONS
# ============================================================

def cloud_create_folder(provider, access_token, folder_name, parent_id=None):
    """Crear carpeta en cloud storage"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    if provider == 'google_drive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files"
        metadata = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder'
        }
        if parent_id:
            metadata['parents'] = [parent_id]
        
        response = make_secure_request('POST', url, headers={
            **headers,
            'Content-Type': 'application/json'
        }, data=json.dumps(metadata))
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'folder': {'id': data['id'], 'name': data['name']}}
    
    elif provider == 'dropbox':
        headers['Content-Type'] = 'application/json'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/create_folder_v2"
        path = f"{parent_id or ''}/{folder_name}"
        if not path.startswith('/'):
            path = '/' + path
        
        payload = {'path': path, 'autorename': False}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'folder': {'id': data['metadata']['path_display'], 'name': data['metadata']['name']}}
    
    elif provider == 'box':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/folders"
        payload = {'name': folder_name, 'parent': {'id': parent_id or '0'}}
        response = make_secure_request('POST', url, headers={
            **headers,
            'Content-Type': 'application/json'
        }, data=json.dumps(payload))
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'folder': {'id': data['id'], 'name': data['name']}}
    
    elif provider == 'onedrive':
        if parent_id:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{parent_id}/children"
        else:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/root/children"
        
        payload = {'name': folder_name, 'folder': {}, '@microsoft.graph.conflictBehavior': 'rename'}
        response = make_secure_request('POST', url, headers={
            **headers,
            'Content-Type': 'application/json'
        }, data=json.dumps(payload))
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'folder': {'id': data['id'], 'name': data['name']}}
    
    return {'error': 'Provider not supported'}

def cloud_rename_item(provider, access_token, item_id, new_name, item_type='file'):
    """Renombrar archivo o carpeta en cloud storage"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        payload = {'name': new_name}
        try:
            response = make_secure_request('PATCH', url, headers=headers, json=payload)
            if response.status_code != 200:
                error_msg = response.text
                print(f"Google Drive rename error {response.status_code}: {error_msg}")
                return {'success': False, 'error': f'API Error: {response.status_code}'}
            return {'success': True}
        except Exception as e:
            print(f"Google Drive rename exception: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}

    
    elif provider == 'dropbox':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/move_v2"
        # Para renombrar en Dropbox, necesitamos mover a la misma ubicación con nuevo nombre
        old_path = item_id
        parent_path = '/'.join(old_path.rsplit('/', 1)[:-1]) or ''
        new_path = f"{parent_path}/{new_name}"
        
        payload = {'from_path': old_path, 'to_path': new_path}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'box':
        endpoint = 'folders' if item_type == 'folder' else 'files'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/{endpoint}/{item_id}"
        payload = {'name': new_name}
        response = make_secure_request('PUT', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{item_id}"
        payload = {'name': new_name}
        response = make_secure_request('PATCH', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    return {'error': 'Provider not supported'}

def cloud_move_item(provider, access_token, item_id, new_parent_id, item_type='file'):
    """Mover archivo o carpeta a otra ubicación"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        # Get current parents first
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        params = {'fields': 'parents'}
        response = make_secure_request('GET', url, headers={'Authorization': f'Bearer {access_token}'}, params=params)
        response.raise_for_status()
        current_parents = response.json().get('parents', [])
        
        # Move to new parent
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        params = {
            'addParents': new_parent_id or 'root',
            'removeParents': ','.join(current_parents)
        }
        response = make_secure_request('PATCH', url, headers=headers, params=params)
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'dropbox':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/move_v2"
        old_path = item_id
        filename = old_path.rsplit('/', 1)[-1]
        new_path = f"{new_parent_id or ''}/{filename}"
        
        payload = {'from_path': old_path, 'to_path': new_path}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'box':
        endpoint = 'folders' if item_type == 'folder' else 'files'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/{endpoint}/{item_id}"
        payload = {'parent': {'id': new_parent_id or '0'}}
        response = make_secure_request('PUT', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{item_id}"
        if new_parent_id:
            payload = {'parentReference': {'id': new_parent_id}}
        else:
            payload = {'parentReference': {'path': '/drive/root'}}
        response = make_secure_request('PATCH', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    return {'error': 'Provider not supported'}

def cloud_delete_item(provider, access_token, item_id, item_type='file'):
    """Eliminar archivo o carpeta (mover a papelera si es posible)"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    if provider == 'google_drive':
        # Google Drive: Mover a papelera (trashed=true)
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        payload = {'trashed': True}
        response = make_secure_request('PATCH', url, headers={
            **headers,
            'Content-Type': 'application/json'
        }, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'dropbox':
        headers['Content-Type'] = 'application/json'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/delete_v2"
        payload = {'path': item_id}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'box':
        endpoint = 'folders' if item_type == 'folder' else 'files'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/{endpoint}/{item_id}"
        if item_type == 'folder':
            url += '?recursive=true'
        response = make_secure_request('DELETE', url, headers=headers)
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{item_id}"
        response = make_secure_request('DELETE', url, headers=headers)
        response.raise_for_status()
        return {'success': True}
    
    return {'error': 'Provider not supported'}

def cloud_restore_item(provider, access_token, item_id):
    """Restaurar archivo de la papelera"""
    headers = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}
    
    if provider == 'google_drive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        payload = {'trashed': False}
        response = make_secure_request('PATCH', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        return {'success': True}
    
    elif provider == 'dropbox':
        # Dropbox: Restore from version history
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/restore"
        payload = {'path': item_id, 'rev': 'latest'}
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        if response.status_code == 200:
            return {'success': True}
        return {'error': 'Cannot restore - Dropbox delete is permanent'}
    
    elif provider == 'box':
        # Box: Restore from trash
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{item_id}"
        response = make_secure_request('POST', url, headers=headers)
        if response.status_code == 200:
            return {'success': True}
        return {'error': 'Cannot restore from Box trash'}
    
    elif provider == 'onedrive':
        # OneDrive items go to recycle bin, need special restore
        return {'error': 'OneDrive restore requires manual action in web interface'}
    
    return {'error': 'Provider not supported'}

def cloud_upload_file(provider, access_token, file, parent_id=None):
    """Subir archivo a cloud storage"""
    headers = {'Authorization': f'Bearer {access_token}'}
    file_content = file.read()
    filename = file.filename
    
    if provider == 'google_drive':
        # Simple upload for files < 5MB
        boundary = '-------314159265358979323846'
        metadata = {'name': filename}
        if parent_id:
            metadata['parents'] = [parent_id]
        
        body = (
            f'--{boundary}\r\n'
            f'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            f'{json.dumps(metadata)}\r\n'
            f'--{boundary}\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n'
        ).encode('utf-8') + file_content + f'\r\n--{boundary}--'.encode('utf-8')
        
        url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
        response = requests.post(url, headers={
            **headers,
            'Content-Type': f'multipart/related; boundary={boundary}'
        }, data=body)
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'file': {'id': data['id'], 'name': data.get('name', filename)}}
    
    elif provider == 'dropbox':
        url = 'https://content.dropboxapi.com/2/files/upload'
        path = f"{parent_id or ''}/{filename}"
        if not path.startswith('/'):
            path = '/' + path
        
        response = requests.post(url, headers={
            **headers,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': json.dumps({'path': path, 'mode': 'add', 'autorename': True})
        }, data=file_content)
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'file': {'id': data['id'], 'name': data['name']}}
    
    elif provider == 'box':
        url = 'https://upload.box.com/api/2.0/files/content'
        attributes = json.dumps({'name': filename, 'parent': {'id': parent_id or '0'}})
        
        response = requests.post(url, headers=headers, files={
            'attributes': (None, attributes),
            'file': (filename, file_content)
        })
        response.raise_for_status()
        data = response.json()
        entry = data['entries'][0] if data.get('entries') else {}
        return {'success': True, 'file': {'id': entry.get('id'), 'name': entry.get('name', filename)}}
    
    elif provider == 'onedrive':
        if parent_id:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{parent_id}:/{filename}:/content"
        else:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/root:/{filename}:/content"
        
        response = requests.put(url, headers={
            **headers,
            'Content-Type': 'application/octet-stream'
        }, data=file_content)
        response.raise_for_status()
        data = response.json()
        return {'success': True, 'file': {'id': data['id'], 'name': data.get('name', filename)}}
    
    return {'error': 'Provider not supported'}

def cloud_download_file(provider, access_token, file_id):
    """Descargar archivo de cloud storage"""
    from flask import Response
    headers = {'Authorization': f'Bearer {access_token}'}
    
    if provider == 'google_drive':
        # Get file metadata first
        meta_url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}"
        meta_response = make_secure_request('GET', meta_url, headers=headers, params={'fields': 'name,mimeType'})
        meta_response.raise_for_status()
        meta = meta_response.json()
        
        # Download content
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}?alt=media"
        response = requests.get(url, headers=headers, stream=True)
        response.raise_for_status()
        
        return Response(
            response.iter_content(chunk_size=8192),
            headers={
                'Content-Disposition': f'attachment; filename="{meta.get("name", "download")}"',
                'Content-Type': meta.get('mimeType', 'application/octet-stream')
            }
        )
    
    elif provider == 'dropbox':
        url = 'https://content.dropboxapi.com/2/files/download'
        response = requests.post(url, headers={
            **headers,
            'Dropbox-API-Arg': json.dumps({'path': file_id})
        }, stream=True)
        response.raise_for_status()
        
        # Get filename from API response header
        api_result = json.loads(response.headers.get('Dropbox-API-Result', '{}'))
        filename = api_result.get('name', 'download')
        
        return Response(
            response.iter_content(chunk_size=8192),
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Type': 'application/octet-stream'
            }
        )
    
    elif provider == 'box':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/{file_id}/content"
        response = requests.get(url, headers=headers, stream=True, allow_redirects=True)
        response.raise_for_status()
        
        return Response(
            response.iter_content(chunk_size=8192),
            headers={
                'Content-Disposition': 'attachment; filename="download"',
                'Content-Type': 'application/octet-stream'
            }
        )
    
    elif provider == 'onedrive':
        url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{file_id}/content"
        response = requests.get(url, headers=headers, stream=True, allow_redirects=True)
        response.raise_for_status()
        
        return Response(
            response.iter_content(chunk_size=8192),
            headers={
                'Content-Disposition': 'attachment; filename="download"',
                'Content-Type': 'application/octet-stream'
            }
        )
    
    return jsonify({'error': 'Provider not supported'}), 400

def fetch_folder_content(provider, access_token, folder_id=None):
    """Obtener contenido de una carpeta específica (carpetas y archivos filtrados)"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    folders = []
    files = []
    
    # Extensiones de documentos permitidas
    document_extensions = {'.pdf', '.doc', '.docx', '.txt', '.epub', '.ppt', '.pptx', '.rtf', '.mobi'}
    document_mime_types = {
        'application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.google-apps.document', 'application/vnd.google-apps.presentation',
        'application/epub+zip', 'application/rtf'
    }
    
    if provider == 'google_drive':
        # Google Drive: listar contenido de carpeta específica
        parent_id = folder_id if folder_id else 'root'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files"
        params = {
            'q': f"'{parent_id}' in parents and trashed=false",
            'fields': 'files(id,name,size,modifiedTime,mimeType,webViewLink)',
            'pageSize': 100,
            'orderBy': 'folder,name'
        }
        
        response = make_secure_request('GET', url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        
        for item in data.get('files', []):
            if item.get('mimeType') == 'application/vnd.google-apps.folder':
                folders.append({
                    'id': item['id'],
                    'name': item['name'],
                    'type': 'folder',
                    'provider': 'google_drive'
                })
            elif item.get('mimeType') in document_mime_types or any(item.get('name', '').lower().endswith(ext) for ext in document_extensions):
                files.append({
                    'id': item['id'],
                    'name': item['name'],
                    'size': int(item.get('size', 0)),
                    'modified': item.get('modifiedTime'),
                    'type': item.get('mimeType'),
                    'download_url': item.get('webViewLink'),
                    'provider': 'google_drive'
                })
    
    elif provider == 'dropbox':
        headers['Content-Type'] = 'application/json'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/list_folder"
        
        path = ""
        if folder_id:
            # folder_id en Dropbox es la ruta
            path = folder_id if folder_id.startswith('/') else f"/{folder_id}"
        
        payload = {
            "path": path,
            "recursive": False,
            "include_deleted": False,
            "include_mounted_folders": True
        }
        
        response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
        response.raise_for_status()
        data = response.json()
        
        for entry in data.get('entries', []):
            if entry.get('.tag') == 'folder':
                folders.append({
                    'id': entry.get('path_display', ''),
                    'name': entry.get('name', ''),
                    'type': 'folder',
                    'provider': 'dropbox'
                })
            elif entry.get('.tag') == 'file':
                name = entry.get('name', '')
                if any(name.lower().endswith(ext) for ext in document_extensions):
                    files.append({
                        'id': entry.get('id', ''),
                        'name': name,
                        'size': entry.get('size', 0),
                        'modified': entry.get('server_modified', ''),
                        'type': 'file',
                        'path': entry.get('path_display', ''),
                        'provider': 'dropbox'
                    })
    
    elif provider == 'box':
        folder_box_id = folder_id if folder_id else '0'
        url = f"{OAUTH_CONFIG[provider]['api_base']}/folders/{folder_box_id}/items"
        params = {'fields': 'id,name,size,modified_at,type', 'limit': 200}
        
        response = make_secure_request('GET', url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        
        for entry in data.get('entries', []):
            if entry.get('type') == 'folder':
                folders.append({
                    'id': entry['id'],
                    'name': entry['name'],
                    'type': 'folder',
                    'provider': 'box'
                })
            elif entry.get('type') == 'file':
                name = entry.get('name', '')
                if any(name.lower().endswith(ext) for ext in document_extensions):
                    files.append({
                        'id': entry['id'],
                        'name': name,
                        'size': entry.get('size', 0),
                        'modified': entry.get('modified_at'),
                        'type': 'file',
                        'provider': 'box'
                    })
    
    elif provider == 'onedrive':
        if folder_id:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/items/{folder_id}/children"
        else:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/root/children"
        
        params = {'$select': 'id,name,size,lastModifiedDateTime,file,folder,webUrl', '$top': 200}
        
        response = make_secure_request('GET', url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()
        
        for item in data.get('value', []):
            if 'folder' in item:
                folders.append({
                    'id': item['id'],
                    'name': item['name'],
                    'type': 'folder',
                    'provider': 'onedrive'
                })
            elif 'file' in item:
                name = item.get('name', '')
                if any(name.lower().endswith(ext) for ext in document_extensions):
                    files.append({
                        'id': item['id'],
                        'name': name,
                        'size': item.get('size', 0),
                        'modified': item.get('lastModifiedDateTime'),
                        'type': item.get('file', {}).get('mimeType', 'file'),
                        'download_url': item.get('webUrl'),
                        'provider': 'onedrive'
                    })
    
    return {'folders': folders, 'files': files}

def fetch_files_from_provider(provider, access_token):
    """Obtener archivos específicos de cada proveedor - busca en TODAS las carpetas"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    if provider == 'google_drive':
        # Usar query para buscar documentos en TODA la unidad (no solo raíz)
        # Esto busca por MIME types de documentos
        document_mime_types = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/epub+zip',
            'application/rtf'
        ]
        
        # Construir query OR para todos los MIME types
        mime_queries = [f"mimeType='{mime}'" for mime in document_mime_types]
        query = "(" + " or ".join(mime_queries) + ") and trashed=false"
        
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files"
        all_files = []
        page_token = None
        
        while True:
            params = {
                'q': query,
                'fields': 'nextPageToken,files(id,name,size,modifiedTime,mimeType,webViewLink,parents)',
                'pageSize': 100,
                'orderBy': 'modifiedTime desc'
            }
            if page_token:
                params['pageToken'] = page_token
            
            response = make_secure_request('GET', url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            
            for file in data.get('files', []):
                all_files.append({
                    'id': file['id'],
                    'name': file['name'],
                    'size': int(file.get('size', 0)),
                    'modified': file.get('modifiedTime'),
                    'type': file.get('mimeType'),
                    'download_url': file.get('webViewLink'),
                    'provider': 'google_drive'
                })
            
            page_token = data.get('nextPageToken')
            if not page_token:
                break
        
        print(f"DEBUG - Google Drive total documents found: {len(all_files)}")
        return all_files
    
    elif provider == 'dropbox':
        # Dropbox requiere headers específicos
        headers['Content-Type'] = 'application/json'
        
        # Listar TODAS las carpetas recursivamente
        url = f"{OAUTH_CONFIG[provider]['api_base']}/files/list_folder"
        
        # Payload con recursive=True para buscar en todas las subcarpetas
        payload = {
            "path": "",  # Carpeta raíz
            "recursive": True,  # Buscar en TODAS las subcarpetas
            "include_media_info": False,
            "include_deleted": False,
            "include_has_explicit_shared_members": False,
            "include_mounted_folders": True,
            "limit": 2000  # Máximo permitido por Dropbox
        }
        
        print(f"Dropbox request payload: {json.dumps(payload)}")  # Debug
        
        try:
            response = make_secure_request('POST', url, headers=headers, data=json.dumps(payload))
            print(f"Dropbox response status: {response.status_code}")  # Debug
            
            response.raise_for_status()
            data = response.json()
            
            print(f"Dropbox response data: {json.dumps(data, indent=2)}")  # Debug
            
            files = []
            entries = data.get('entries', [])
            
            for entry in entries:
                print(f"Processing entry: {entry.get('name')} - Tag: {entry.get('.tag')}")  # Debug
                
                # Verificar que sea un archivo (no carpeta)
                if entry.get('.tag') == 'file':
                    file_info = {
                        'id': entry.get('id', ''),
                        'name': entry.get('name', ''),
                        'size': entry.get('size', 0),
                        'modified': entry.get('server_modified', ''),
                        'type': 'file',  # Dropbox no proporciona MIME type en list_folder
                        'path': entry.get('path_display', ''),
                        'provider': 'dropbox'
                    }
                    files.append(file_info)
                    print(f"Added file: {file_info['name']}")  # Debug
            
            # Manejo de paginación si hay más archivos
            has_more = data.get('has_more', False)
            cursor = data.get('cursor', '')
            
            while has_more:
                continue_url = f"{OAUTH_CONFIG[provider]['api_base']}/files/list_folder/continue"
                continue_payload = {"cursor": cursor}
                
                response = make_secure_request('POST', continue_url, headers=headers, data=json.dumps(continue_payload))
                response.raise_for_status()
                data = response.json()
                
                for entry in data.get('entries', []):
                    if entry.get('.tag') == 'file':
                        file_info = {
                            'id': entry.get('id', ''),
                            'name': entry.get('name', ''),
                            'size': entry.get('size', 0),
                            'modified': entry.get('server_modified', ''),
                            'type': 'file',
                            'path': entry.get('path_display', ''),
                            'provider': 'dropbox'
                        }
                        files.append(file_info)
                
                has_more = data.get('has_more', False)
                cursor = data.get('cursor', '')
            
            print(f"Total Dropbox files found: {len(files)}")  # Debug
            return files
            
        except Exception as e:
            print(f"Error detallado en Dropbox: {e}")
            print(f"Response content: {getattr(response, 'text', 'No response text')}")
            raise
    
    elif provider == 'box':
        # Box: Usar la API de búsqueda para encontrar documentos en todas las carpetas
        # Las extensiones de documento soportadas
        document_extensions = ['pdf', 'doc', 'docx', 'txt', 'ppt', 'pptx', 'epub', 'rtf']
        
        all_files = []
        
        for ext in document_extensions:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/search"
            params = {
                'query': f'*.{ext}',
                'type': 'file',
                'file_extensions': ext,
                'fields': 'id,name,size,modified_at,type',
                'limit': 200
            }
            
            try:
                response = make_secure_request('GET', url, headers=headers, params=params)
                if response.status_code == 200:
                    data = response.json()
                    for entry in data.get('entries', []):
                        if entry.get('type') == 'file':
                            all_files.append({
                                'id': entry['id'],
                                'name': entry['name'],
                                'size': entry.get('size', 0),
                                'modified': entry.get('modified_at'),
                                'type': entry.get('type'),
                                'provider': 'box'
                            })
            except Exception as e:
                print(f"Box search error for {ext}: {e}")
                continue
        
        # Eliminar duplicados basado en ID
        seen_ids = set()
        unique_files = []
        for f in all_files:
            if f['id'] not in seen_ids:
                seen_ids.add(f['id'])
                unique_files.append(f)
        
        print(f"DEBUG - Box total documents found: {len(unique_files)}")
        return unique_files
    
    elif provider == 'onedrive':
        # OneDrive: Usar la API de búsqueda de Microsoft Graph para buscar documentos
        # Buscar por extensiones de documentos
        document_extensions = ['pdf', 'doc', 'docx', 'txt', 'ppt', 'pptx', 'epub', 'rtf']
        
        all_files = []
        
        # Microsoft Graph API soporta búsqueda de múltiples extensiones
        for ext in document_extensions:
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive/root/search(q='.{ext}')"
            params = {
                '$select': 'id,name,size,lastModifiedDateTime,file,webUrl',
                '$top': 200
            }
            
            try:
                response = make_secure_request('GET', url, headers=headers, params=params)
                if response.status_code == 200:
                    data = response.json()
                    for item in data.get('value', []):
                        # Solo incluir si es un archivo (tiene la propiedad 'file')
                        if 'file' in item:
                            all_files.append({
                                'id': item['id'],
                                'name': item['name'],
                                'size': item.get('size', 0),
                                'modified': item.get('lastModifiedDateTime'),
                                'type': item.get('file', {}).get('mimeType', 'file'),
                                'download_url': item.get('webUrl'),
                                'provider': 'onedrive'
                            })
            except Exception as e:
                print(f"OneDrive search error for {ext}: {e}")
                continue
        
        # Eliminar duplicados basado en ID
        seen_ids = set()
        unique_files = []
        for f in all_files:
            if f['id'] not in seen_ids:
                seen_ids.add(f['id'])
                unique_files.append(f)
        
        print(f"DEBUG - OneDrive total documents found: {len(unique_files)}")
        return unique_files

    return []

def fetch_storage_quota(provider, access_token):
    """Obtener cuota de almacenamiento del proveedor"""
    headers = {'Authorization': f'Bearer {access_token}'}
    
    try:
        if provider == 'google_drive':
            url = f"{OAUTH_CONFIG[provider]['api_base']}/about"
            params = {'fields': 'storageQuota'}
            response = make_secure_request('GET', url, headers=headers, params=params)
            response.raise_for_status()
            quota = response.json().get('storageQuota', {})
            return {
                'total_storage': int(quota.get('limit', 0)),
                'used_storage': int(quota.get('usage', 0))
            }
            
        elif provider == 'dropbox':
            url = f"{OAUTH_CONFIG[provider]['api_base']}/users/get_space_usage"
            headers['Content-Type'] = 'application/json'
            response = make_secure_request('POST', url, headers=headers, data='null')
            response.raise_for_status()
            data = response.json()
            # Dropbox puede tener allocation individual o de equipo
            allocation = data.get('allocation', {})
            total = allocation.get('allocated', 0) if 'allocated' in allocation else 0
            if 'individual' in allocation:
                total = allocation['individual'].get('allocated', 0)
            elif 'team' in allocation:
                total = allocation['team'].get('allocated', 0)
                
            return {
                'total_storage': total,
                'used_storage': data.get('used', 0)
            }
            
        elif provider == 'box':
            url = f"{OAUTH_CONFIG[provider]['api_base']}/users/me"
            params = {'fields': 'space_amount,space_used'}
            response = make_secure_request('GET', url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            return {
                'total_storage': data.get('space_amount', 0),
                'used_storage': data.get('space_used', 0)
            }

        elif provider == 'onedrive':
            url = f"{OAUTH_CONFIG[provider]['api_base']}/me/drive"
            response = make_secure_request('GET', url, headers=headers)
            response.raise_for_status()
            data = response.json()
            quota = data.get('quota', {})
            return {
                'total_storage': quota.get('total', 0),
                'used_storage': quota.get('used', 0)
            }
            
    except Exception as e:
        print(f"Error fetching quota for {provider}: {e}")
        # Return error structure so frontend knows it failed
        return {'error': str(e)}
        
    return {'error': 'Unknown provider or unhandled error'}

@x_integ.route('/storage/usage/<provider>')
@login_required
def get_storage_usage(provider):
    """Obtener uso de almacenamiento de un proveedor"""
    if 'user_id' not in session:
        return jsonify({'error': 'Usuario no autenticado'}), 401
        
    user_tokens = get_user_tokens(session['user_id'])
    
    if provider not in user_tokens:
        return jsonify({'error': 'Proveedor no conectado'}), 404
    
    token_info = user_tokens[provider]
    
    # Verificar expiración y renovar si es necesario
    if is_token_expired(token_info):
        if not refresh_access_token(session['user_id'], provider):
            return jsonify({'error': 'Token expirado'}), 401
        user_tokens = get_user_tokens(session['user_id'])
        token_info = user_tokens[provider]
        
    quota = fetch_storage_quota(provider, token_info['access_token'])
    
    if quota and 'error' not in quota:
        return jsonify(quota)
    else:
        # Si falla, retornar error explícito o nulls pero con status
        error_msg = quota.get('error') if quota else 'Unknown error'
        print(f"Failed to get storage for {provider}: {error_msg}")
        return jsonify({'total_storage': 0, 'used_storage': 0, 'error': error_msg}), 200 # Return 200 so frontend doesn't crash but sees 0

# Función para verificar token de Dropbox
def verify_dropbox_token(access_token):
    """Verificar si el token de Dropbox es válido"""
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }
    
    # Endpoint para verificar información de la cuenta
    url = "https://api.dropboxapi.com/2/users/get_current_account"
    
    try:
        response = make_secure_request('POST', url, headers=headers, data='null')
        print(f"Token verification status: {response.status_code}")
        
        if response.status_code == 200:
            account_info = response.json()
            print(f"Dropbox account: {account_info.get('name', {}).get('display_name', 'Unknown')}")
            return True
        else:
            print(f"Token verification failed: {response.text}")
            return False
            
    except Exception as e:
        print(f"Error verifying Dropbox token: {e}")
        return False

def get_provider_display_name(provider):
    """Obtener nombre para mostrar del proveedor"""
    names = {
        'google_drive': 'Google Drive',
        'dropbox': 'Dropbox',
        'box': 'Box',
        'pcloud': 'pCloud',
        'mega': 'MEGA',
        'yandex': 'Yandex Disk'
    }
    return names.get(provider, provider.title())

@x_integ.route('/documents')
@login_required
def document_manager():
    """Renderizar página del gestor de documentos"""
    return render_template('document_manager.html')

@x_integ.route('/x_buck/api/documents')
@login_required
def get_native_documents():
    """Obtener documentos nativos del sistema"""
    # Aquí va tu lógica existente para obtener documentos nativos
    # Por ahora retorno un ejemplo
    documents = [
        {
            'id': 1,
            'title': 'Documento nativo 1.pdf',
            'size': 1024000,
            'last_modified': '2024-01-15T10:30:00',
            'url': '/download/1',
            'rena': 'documento1.pdf'
        }
    ]
    
    return jsonify({'documents': documents})

# Rutas adicionales para gestión de usuarios
@x_integ.route('/users', methods=['POST'])
def create_user_endpoint():
    """Crear un nuevo usuario"""
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    
    if not username or not email:
        return jsonify({'error': 'Username y email son requeridos'}), 400
    
    user_id = create_user(username, email)
    if user_id:
        return jsonify({'success': True, 'user_id': user_id}), 201
    else:
        return jsonify({'error': 'Error creando usuario'}), 500

@x_integ.route('/users/<int:user_id>')
def get_user_endpoint(user_id):
    """Obtener información de un usuario"""
    user = get_user_by_id(user_id)
    if user:
        return jsonify({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'created_at': user.created_at.isoformat(),
            'updated_at': user.updated_at.isoformat()
        })
    else:
        return jsonify({'error': 'Usuario no encontrado'}), 404