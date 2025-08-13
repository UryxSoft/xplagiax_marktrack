from flask import Blueprint, request, jsonify, render_template_string
from datetime import datetime, timedelta
import json

from settings.extensions import db, limiter, logger
from models.models import Document, DocumentShare, User, DocumentActivity
from settings.utils import (
    validate_email, generate_share_url, send_share_notification_email,
    load_from_minio_compressed, get_cached_document, cache_document
)

share_bp = Blueprint('share', __name__)

@share_bp.route('/document/<int:doc_id>/share', methods=['POST'])
@limiter.limit("10/minute")
def share_document(doc_id):
    """Compartir documento con otro usuario"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No se enviaron datos'}), 400
        
        recipient_email = data.get('recipient_email', '').strip().lower()
        shared_by_email = data.get('shared_by_email', '').strip().lower()
        permission_level = data.get('permission_level', 'read')
        share_message = data.get('message', '').strip()
        expires_in_days = data.get('expires_in_days', 7)
        
        # Validaciones
        if not recipient_email:
            return jsonify({'error': 'Email del destinatario requerido'}), 400
        
        if not validate_email(recipient_email):
            return jsonify({'error': 'Email del destinatario no válido'}), 400
        
        if not shared_by_email:
            return jsonify({'error': 'Email del remitente requerido'}), 400
        
        if not validate_email(shared_by_email):
            return jsonify({'error': 'Email del remitente no válido'}), 400
        
        if permission_level not in ['read', 'write', 'admin']:
            return jsonify({'error': 'Nivel de permiso no válido'}), 400
        
        if recipient_email == shared_by_email:
            return jsonify({'error': 'No puedes compartir contigo mismo'}), 400
        
        # Verificar que el documento existe y no está eliminado
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Crear o obtener usuario destinatario
        recipient_user = User.get_or_create(recipient_email)
        
        # Verificar si ya existe un share activo
        existing_share = DocumentShare.query.filter_by(
            document_id=doc_id,
            user_id=recipient_user.id,
            is_active=True
        ).first()
        
        if existing_share:
            # Actualizar share existente
            existing_share.permission_level = permission_level
            existing_share.shared_by_email = shared_by_email
            existing_share.share_message = share_message
            existing_share.expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
            existing_share.updated_at = datetime.utcnow()
            
            share = existing_share
            action = 'updated'
        else:
            # Crear nuevo share
            share = DocumentShare(
                document_id=doc_id,
                user_id=recipient_user.id,
                permission_level=permission_level,
                shared_by_email=shared_by_email,
                share_message=share_message,
                expires_at=datetime.utcnow() + timedelta(days=expires_in_days)
            )
            db.session.add(share)
            action = 'created'
        
        db.session.commit()
        
        # Generar URL de compartir
        share_url = generate_share_url(request, share.share_token)
        
        # Enviar notificación por email
        email_sent = send_share_notification_email(
            recipient_email=recipient_email,
            document_title=doc.title,
            shared_by_email=shared_by_email,
            share_url=share_url,
            message=share_message
        )
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, shared_by_email, 'shared', 
            f'Documento compartido con {recipient_email} ({permission_level})', request
        )
        
        logger.info(f"Documento {doc_id} compartido con {recipient_email} por {shared_by_email}")
        
        return jsonify({
            'status': 'shared',
            'action': action,
            'share_id': share.id,
            'share_token': share.share_token,
            'share_url': share_url,
            'recipient_email': recipient_email,
            'permission_level': permission_level,
            'expires_at': share.expires_at.isoformat(),
            'email_sent': email_sent,
            'message': f'Documento compartido exitosamente con {recipient_email}'
        })
        
    except Exception as e:
        logger.error(f"Error compartiendo documento {doc_id}: {e}")
        return jsonify({'error': 'Error compartiendo documento'}), 500

@share_bp.route('/shared/<share_token>', methods=['GET'])
def access_shared_document(share_token):
    """Acceder a documento compartido por token"""
    try:
        # Buscar share por token
        share = DocumentShare.query.filter_by(
            share_token=share_token,
            is_active=True
        ).first()
        
        if not share:
            return render_template_string("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Enlace no válido</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Enlace no válido</h1>
                <p>Este enlace no existe o ha sido revocado.</p>
            </body>
            </html>
            """), 404
        
        # Verificar expiración
        if share.is_expired:
            return render_template_string("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Enlace expirado</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Enlace expirado</h1>
                <p>Este enlace ha expirado el {{ expires_at }}.</p>
                <p>Contacta a {{ shared_by }} para obtener un nuevo enlace.</p>
            </body>
            </html>
            """, expires_at=share.expires_at.strftime('%d/%m/%Y %H:%M'), 
                shared_by=share.shared_by_email), 410
        
        # Verificar que el documento existe
        doc = share.document
        if not doc or doc.is_deleted:
            return render_template_string("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Documento no encontrado</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Documento no encontrado</h1>
                <p>El documento compartido ya no está disponible.</p>
            </body>
            </html>
            """), 404
        
        # Registrar acceso
        share.record_access()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc.id, share.user.email, 'shared_access', 
            f'Acceso a documento compartido', request
        )
        
        # Redirigir al editor con token
        redirect_url = f"/?shared_token={share_token}&doc_id={doc.id}&permission={share.permission_level}"
        
        return render_template_string("""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirigiendo...</title>
            <meta charset="utf-8">
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 50px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .container {
                    background: rgba(255,255,255,0.1);
                    padding: 30px;
                    border-radius: 10px;
                    backdrop-filter: blur(10px);
                    max-width: 500px;
                    margin: 0 auto;
                }
                .spinner {
                    border: 3px solid rgba(255,255,255,0.3);
                    border-top: 3px solid white;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📄 Documento Compartido</h2>
                <p><strong>{{ doc_title }}</strong></p>
                <p>Compartido por: {{ shared_by }}</p>
                <p>Nivel de acceso: {{ permission }}</p>
                <div class="spinner"></div>
                <p>Cargando editor...</p>
            </div>
            
            <script>
                setTimeout(function() {
                    window.location.href = '{{ redirect_url }}';
                }, 2000);
            </script>
        </body>
        </html>
        """, doc_title=doc.title, shared_by=share.shared_by_email, 
             permission=share.permission_level, redirect_url=redirect_url)
        
    except Exception as e:
        logger.error(f"Error accediendo documento compartido: {e}")
        return render_template_string("""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .error { color: #dc3545; }
            </style>
        </head>
        <body>
            <h1 class="error">Error</h1>
            <p>Ha ocurrido un error al acceder al documento.</p>
        </body>
        </html>
        """), 500

@share_bp.route('/document/<int:doc_id>/shares', methods=['GET'])
def list_document_shares(doc_id):
    """Listar todos los shares de un documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        shares = DocumentShare.query.filter_by(document_id=doc_id)\
            .order_by(DocumentShare.created_at.desc()).all()
        
        return jsonify({
            'document_id': doc_id,
            'document_title': doc.title,
            'shares': [share.to_dict() for share in shares]
        })
        
    except Exception as e:
        logger.error(f"Error listando shares: {e}")
        return jsonify({'error': 'Error cargando shares'}), 500

@share_bp.route('/share/<int:share_id>/revoke', methods=['POST'])
@limiter.limit("20/minute")
def revoke_share(share_id):
    """Revocar acceso compartido"""
    try:
        user_email = request.args.get('user_email', 'anonymous')
        
        share = DocumentShare.query.get_or_404(share_id)
        
        if not share.is_active:
            return jsonify({'error': 'El share ya está revocado'}), 400
        
        # Revocar share
        share.revoke()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            share.document_id, user_email, 'share_revoked', 
            f'Share revocado para {share.user.email}', request
        )
        
        logger.info(f"Share {share_id} revocado por {user_email}")
        
        return jsonify({
            'status': 'revoked',
            'message': f'Acceso revocado para {share.user.email}',
            'share_id': share_id
        })
        
    except Exception as e:
        logger.error(f"Error revocando share: {e}")
        return jsonify({'error': 'Error revocando acceso'}), 500

@share_bp.route('/share/<int:share_id>/update', methods=['PUT'])
@limiter.limit("20/minute")
def update_share(share_id):
    """Actualizar permisos de share"""
    try:
        data = request.get_json()
        user_email = request.args.get('user_email', 'anonymous')
        
        if not data:
            return jsonify({'error': 'No se enviaron datos'}), 400
        
        share = DocumentShare.query.get_or_404(share_id)
        
        if not share.is_active:
            return jsonify({'error': 'El share no está activo'}), 400
        
        # Actualizar campos permitidos
        permission_level = data.get('permission_level')
        expires_in_days = data.get('expires_in_days')
        
        updated_fields = []
        
        if permission_level and permission_level in ['read', 'write', 'admin']:
            share.permission_level = permission_level
            updated_fields.append(f'permisos: {permission_level}')
        
        if expires_in_days and isinstance(expires_in_days, int) and expires_in_days > 0:
            share.expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
            updated_fields.append(f'expiración: {expires_in_days} días')
        
        if not updated_fields:
            return jsonify({'error': 'No hay cambios válidos'}), 400
        
        share.updated_at = datetime.utcnow()
        db.session.commit()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            share.document_id, user_email, 'share_updated', 
            f'Share actualizado para {share.user.email}: {", ".join(updated_fields)}', 
            request
        )
        
        logger.info(f"Share {share_id} actualizado por {user_email}")
        
        return jsonify({
            'status': 'updated',
            'message': f'Share actualizado: {", ".join(updated_fields)}',
            'share': share.to_dict()
        })
        
    except Exception as e:
        logger.error(f"Error actualizando share: {e}")
        return jsonify({'error': 'Error actualizando share'}), 500

@share_bp.route('/api/shared-document/<share_token>', methods=['GET'])
def get_shared_document_data(share_token):
    """Obtener datos del documento compartido via API"""
    try:
        # Buscar share por token
        share = DocumentShare.query.filter_by(
            share_token=share_token,
            is_active=True
        ).first()
        
        if not share:
            return jsonify({'error': 'Token no válido'}), 404
        
        # Verificar expiración
        if share.is_expired:
            return jsonify({'error': 'Token expirado'}), 410
        
        # Verificar documento
        doc = share.document
        if not doc or doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Cargar contenido del documento
        if doc.storage_type == 'database':
            delta = json.loads(doc.content_delta) if doc.content_delta else {}
            html = doc.content_html or ''
        else:
            delta, html = load_from_minio_compressed(doc.minio_path)
            if delta is None:
                return jsonify({'error': 'Error cargando contenido'}), 500
        
        # Registrar acceso
        share.record_access()
        
        # Preparar respuesta con información limitada según permisos
        response_data = {
            'id': doc.id,
            'title': doc.title,
            'delta': delta,
            'html': html,
            'storage_type': doc.storage_type,
            'size_bytes': doc.size_bytes,
            'created_at': doc.created_at.isoformat(),
            'updated_at': doc.updated_at.isoformat(),
            'share_info': {
                'permission_level': share.permission_level,
                'shared_by': share.shared_by_email,
                'expires_at': share.expires_at.isoformat() if share.expires_at else None,
                'share_message': share.share_message,
                'access_count': share.access_count,
                'readonly': share.permission_level == 'read'
            }
        }
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc.id, share.user.email, 'shared_view', 
            'Documento compartido visualizado via API', request
        )
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error obteniendo documento compartido: {e}")
        return jsonify({'error': 'Error cargando documento'}), 500

@share_bp.route('/user/<email>/shared-documents', methods=['GET'])
def list_user_shared_documents(email):
    """Listar documentos compartidos con un usuario"""
    try:
        if not validate_email(email):
            return jsonify({'error': 'Email no válido'}), 400
        
        user = User.query.filter_by(email=email).first()
        if not user:
            return jsonify({
                'user_email': email,
                'shared_documents': [],
                'total': 0
            })
        
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        include_expired = request.args.get('include_expired', 'false').lower() == 'true'
        
        # Construir query
        query = DocumentShare.query.filter_by(user_id=user.id)
        
        if not include_expired:
            query = query.filter(
                (DocumentShare.expires_at > datetime.utcnow()) | 
                (DocumentShare.expires_at.is_(None))
            )
        
        query = query.filter(DocumentShare.is_active == True)
        query = query.join(Document).filter(Document.is_deleted == False)
        query = query.order_by(DocumentShare.created_at.desc())
        
        # Paginar
        shares = query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        # Convertir a dict con información del documento
        shared_docs = []
        for share in shares.items:
            share_data = share.to_dict()
            share_data['share_url'] = generate_share_url(request, share.share_token)
            share_data['is_expired'] = share.is_expired
            shared_docs.append(share_data)
        
        return jsonify({
            'user_email': email,
            'shared_documents': shared_docs,
            'total': shares.total,
            'pages': shares.pages,
            'current_page': page,
            'has_next': shares.has_next,
            'has_prev': shares.has_prev
        })
        
    except Exception as e:
        logger.error(f"Error listando documentos compartidos: {e}")
        return jsonify({'error': 'Error cargando documentos compartidos'}), 500

@share_bp.route('/share-stats', methods=['GET'])
def get_share_stats():
    """Obtener estadísticas de documentos compartidos"""
    try:
        owner_email = request.args.get('owner_email')
        
        # Estadísticas base
        total_shares = DocumentShare.query.filter_by(is_active=True).count()
        expired_shares = DocumentShare.query.filter(
            DocumentShare.expires_at < datetime.utcnow(),
            DocumentShare.is_active == True
        ).count()
        
        # Documentos más compartidos
        from sqlalchemy import func
        most_shared_query = db.session.query(
            Document.id,
            Document.title,
            func.count(DocumentShare.id).label('share_count')
        ).join(DocumentShare).filter(
            DocumentShare.is_active == True,
            Document.is_deleted == False
        ).group_by(Document.id, Document.title)\
         .order_by(func.count(DocumentShare.id).desc())\
         .limit(10)
        
        if owner_email:
            user = User.query.filter_by(email=owner_email).first()
            if user:
                most_shared_query = most_shared_query.filter(Document.owner_id == user.id)
        
        most_shared = most_shared_query.all()
        
        # Actividad reciente de shares
        recent_shares = DocumentShare.query.filter_by(is_active=True)\
            .order_by(DocumentShare.created_at.desc())\
            .limit(10).all()
        
        return jsonify({
            'total_active_shares': total_shares,
            'expired_shares': expired_shares,
            'most_shared_documents': [
                {
                    'document_id': doc.id,
                    'title': doc.title,
                    'share_count': count
                } for doc, count in most_shared
            ],
            'recent_shares': [
                {
                    'document_title': share.document.title,
                    'shared_with': share.user.email,
                    'shared_by': share.shared_by_email,
                    'permission_level': share.permission_level,
                    'created_at': share.created_at.isoformat(),
                    'access_count': share.access_count
                } for share in recent_shares
            ],
            'owner_email': owner_email
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de shares: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500