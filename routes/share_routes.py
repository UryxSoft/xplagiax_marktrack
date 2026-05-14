from flask import Blueprint, request, jsonify, render_template_string
from flask_login import login_required, current_user
from datetime import datetime, timedelta
import json

from settings.extensions import db, limiter, logger
from models.models import Document, DocumentShare, User, DocumentActivity, Folder, FolderShare, NotificationType
from services.notification_service import NotificationService
from settings.utils import (
    validate_email, generate_share_url, send_share_notification_email,
    load_from_minio_compressed, get_cached_document, cache_document
)

share_bp = Blueprint('share', __name__)

@share_bp.route('/document/<int:doc_id>/share', methods=['POST'])
@login_required
@limiter.limit("10/minute")
def share_document(doc_id):
    """Compartir documento con otro usuario"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        recipient_email = data.get('recipient_email', '').strip().lower()
        permission_level = data.get('permission_level', 'read')
        share_message = data.get('message', '').strip()
        user_settings = current_user.get_settings() if hasattr(current_user, 'get_settings') else {}
        default_expiry_days = user_settings.get('workspace', {}).get('share_link_expiry_days', 7)
        expires_in_days = data.get('expires_in_days', default_expiry_days)
        
        # Use authenticated user as the sharer
        shared_by_email = current_user.email
        
        # Validaciones
        if not recipient_email:
            return jsonify({'error': 'Recipient email required'}), 400
        
        if not validate_email(recipient_email):
            return jsonify({'error': 'Invalid recipient email'}), 400
        
        if permission_level not in ['read', 'write', 'admin']:
            return jsonify({'error': 'Invalid permission level'}), 400
        
        if recipient_email == shared_by_email:
            return jsonify({'error': 'You cannot share with yourself'}), 400
        
        # Verificar que el documento existe, no está eliminado, y es propiedad del usuario
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Document not found'}), 404
        
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'Unauthorized: only the owner can share'}), 403
        
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
            f'Document shared with {recipient_email} ({permission_level})', request
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
            'message': f'Document shared successfully with {recipient_email}'
        })
        
    except Exception as e:
        logger.error(f"Error sharing document {doc_id}: {e}")
        return jsonify({'error': 'Error sharing document'}), 500

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
                <title>Invalid link</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Invalid link</h1>
                <p>This link does not exist or has been revoked.</p>
            </body>
            </html>
            """), 404
        
        # Verificar expiración
        if share.is_expired:
            return render_template_string("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Link expired</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Link expired</h1>
                <p>This link expired on {{ expires_at }}.</p>
                <p>Contact {{ shared_by }} to get a new link.</p>
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
                <title>Document not found</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">Document not found</h1>
                <p>The shared document is no longer available.</p>
            </body>
            </html>
            """), 404
        
        # Registrar acceso
        share.record_access()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc.id, share.shared_with_user.email, 'shared_access', 
            f'Access to shared document', request
        )
        
        # Redirigir al editor con token
        redirect_url = f"/?shared_token={share_token}&doc_id={doc.id}&permission={share.permission_level}"
        
        return render_template_string("""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirecting...</title>
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
                <h2>📄 Shared Document</h2>
                <p><strong>{{ doc_title }}</strong></p>
                <p>Shared by: {{ shared_by }}</p>
                <p>Access level: {{ permission }}</p>
                <div class="spinner"></div>
                <p>Loading editor...</p>
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
            <p>An error occurred while accessing the document.</p>
        </body>
        </html>
        """), 500

@share_bp.route('/document/<int:doc_id>/shares', methods=['GET'])
@login_required
def list_document_shares(doc_id):
    """Listar todos los shares de un documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Document not found'}), 404
        
        # Verify ownership
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        shares = DocumentShare.query.filter_by(document_id=doc_id)\
            .order_by(DocumentShare.created_at.desc()).all()
        
        return jsonify({
            'document_id': doc_id,
            'document_title': doc.title,
            'shares': [share.to_dict() for share in shares]
        })
        
    except Exception as e:
        logger.error(f"Error listing shares: {e}")
        return jsonify({'error': 'Error loading shares'}), 500

@share_bp.route('/share/<int:share_id>/revoke', methods=['POST'])
@login_required
@limiter.limit("20/minute")
def revoke_share(share_id):
    """Revocar acceso compartido"""
    try:
        share = DocumentShare.query.get_or_404(share_id)
        
        # Verify the share belongs to a document owned by current user
        doc = Document.query.get(share.document_id)
        if not doc or doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        if not share.is_active:
            return jsonify({'error': 'The share is already revoked'}), 400
        
        # Revocar share
        share.revoke()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            share.document_id, current_user.email, 'share_revoked', 
            f'Share revoked for {share.shared_with_user.email}', request
        )
        
        logger.info(f"Share {share_id} revocado por {current_user.email}")
        
        return jsonify({
            'status': 'revoked',
            'message': f'Access revoked for {share.shared_with_user.email}',
            'share_id': share_id
        })
        
    except Exception as e:
        logger.error(f"Error revoking share: {e}")
        return jsonify({'error': 'Error revoking access'}), 500

@share_bp.route('/share/<int:share_id>/update', methods=['PUT'])
@login_required
@limiter.limit("20/minute")
def update_share(share_id):
    """Actualizar permisos de share"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No se enviaron datos'}), 400
        
        share = DocumentShare.query.get_or_404(share_id)
        
        # Verify the share belongs to a document owned by current user
        doc = Document.query.get(share.document_id)
        if not doc or doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        if not share.is_active:
            return jsonify({'error': 'The share is not active'}), 400
        
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
            return jsonify({'error': 'No valid changes provided'}), 400
        
        share.updated_at = datetime.utcnow()
        db.session.commit()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            share.document_id, current_user.email, 'share_updated', 
            f'Share updated for {share.shared_with_user.email}: {", ".join(updated_fields)}', 
            request
        )
        
        logger.info(f"Share {share_id} actualizado por {current_user.email}")
        
        return jsonify({
            'status': 'updated',
            'message': f'Share updated: {", ".join(updated_fields)}',
            'share': share.to_dict()
        })
        
    except Exception as e:
        logger.error(f"Error updating share: {e}")
        return jsonify({'error': 'Error updating share'}), 500

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
            return jsonify({'error': 'Invalid token'}), 404
        
        # Verificar expiración
        if share.is_expired:
            return jsonify({'error': 'Token expired'}), 410
        
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
            doc.id, share.shared_with_user.email, 'shared_view', 
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
@login_required
def get_share_stats():
    """Obtener estadísticas de documentos compartidos del usuario autenticado"""
    try:
        # Scoped to current user's documents
        total_shares = DocumentShare.query.join(Document).filter(
            Document.owner_id == current_user.id,
            DocumentShare.is_active == True
        ).count()
        expired_shares = DocumentShare.query.join(Document).filter(
            Document.owner_id == current_user.id,
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
            Document.is_deleted == False,
            Document.owner_id == current_user.id
        ).group_by(Document.id, Document.title)\
         .order_by(func.count(DocumentShare.id).desc())\
         .limit(10)
        
        most_shared = most_shared_query.all()
        
        # Actividad reciente de shares
        recent_shares = DocumentShare.query.join(Document).filter(
            Document.owner_id == current_user.id,
            DocumentShare.is_active == True
        ).order_by(DocumentShare.created_at.desc())\
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
                    'shared_with': share.shared_with_user.email,
                    'shared_by': share.shared_by_email,
                    'permission_level': share.permission_level,
                    'created_at': share.created_at.isoformat(),
                    'access_count': share.access_count
                } for share in recent_shares
            ],
            'owner_id': current_user.id
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de shares: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500

@share_bp.route('/api/resource/share', methods=['POST'])
@limiter.limit("20/minute")
def bulk_share_resource():
    """Compartir documento o carpeta con múltiples usuarios"""
    from flask_login import current_user
    
    # Try to get current user, otherwise fallback to anonymous or error
    try:
        shared_by_email = current_user.email
    except AttributeError:
        # Fallback si no hay login
        return jsonify({'error': 'You must log in to share'}), 401
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No se enviaron datos'}), 400
            
        emails = data.get('emails', [])
        resource_id = data.get('resource_id')
        resource_type = data.get('resource_type', 'document')
        permission_level = data.get('permission_level', 'read')
        share_message = data.get('message', '').strip()
        
        if not emails or not isinstance(emails, list):
            return jsonify({'error': 'Se requiere una lista de emails'}), 400
            
        if not resource_id:
            return jsonify({'error': 'Falta el ID del recurso'}), 400
            
        if permission_level not in ['read', 'write', 'admin', 'viewer', 'editor']:
            return jsonify({'error': 'Permiso no válido'}), 400
        
        # Normalizar permisos (frontend vs backend)
        if permission_level == 'viewer': permission_level = 'read'
        if permission_level == 'editor': permission_level = 'write'
        
        # Validar recurso
        resource_title = "Recurso"
        if resource_type.lower() == 'folder':
            folder = Folder.query.get_or_404(resource_id)
            if folder.is_deleted:
                return jsonify({'error': 'Carpeta no encontrada'}), 404
            resource_title = folder.name
        else:
            doc = Document.query.get_or_404(resource_id)
            if doc.is_deleted:
                return jsonify({'error': 'Documento no encontrado'}), 404
            resource_title = doc.title

        results = []
        for raw_email in emails:
            recipient_email = raw_email.strip().lower()
            if not validate_email(recipient_email):
                results.append({'email': recipient_email, 'status': 'error', 'message': 'Email inválido'})
                continue
                
            if recipient_email == shared_by_email:
                results.append({'email': recipient_email, 'status': 'error', 'message': 'No puedes compartir contigo mismo'})
                continue
                
            recipient_user = User.get_or_create(recipient_email)
            user_settings = current_user.get_settings() if hasattr(current_user, 'get_settings') else {}
            expires_in_days = user_settings.get('workspace', {}).get('share_link_expiry_days', 7)
            share = None
            
            if resource_type.lower() == 'folder':
                existing_share = FolderShare.query.filter_by(folder_id=resource_id, user_id=recipient_user.id, is_active=True).first()
                if existing_share:
                    existing_share.permission_level = permission_level
                    existing_share.shared_by_email = shared_by_email
                    existing_share.share_message = share_message
                    existing_share.expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
                    existing_share.updated_at = datetime.utcnow()
                    share = existing_share
                else:
                    share = FolderShare(
                        folder_id=resource_id,
                        user_id=recipient_user.id,
                        permission_level=permission_level,
                        shared_by_email=shared_by_email,
                        share_message=share_message,
                        expires_at=datetime.utcnow() + timedelta(days=expires_in_days)
                    )
                    db.session.add(share)
            else:
                existing_share = DocumentShare.query.filter_by(document_id=resource_id, user_id=recipient_user.id, is_active=True).first()
                if existing_share:
                    existing_share.permission_level = permission_level
                    existing_share.shared_by_email = shared_by_email
                    existing_share.share_message = share_message
                    existing_share.expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
                    existing_share.updated_at = datetime.utcnow()
                    share = existing_share
                else:
                    share = DocumentShare(
                        document_id=resource_id,
                        user_id=recipient_user.id,
                        permission_level=permission_level,
                        shared_by_email=shared_by_email,
                        share_message=share_message,
                        expires_at=datetime.utcnow() + timedelta(days=expires_in_days)
                    )
                    db.session.add(share)
            
            db.session.commit()
            
            share_url = generate_share_url(request, share.share_token)
            
            # —— Notification: share_received ——
            try:
                actor_name = shared_by_email.split('@')[0]
                view_url   = '/?filter=shared-to-me'
                NotificationService.create(
                    user_id  = recipient_user.id,
                    type     = NotificationType.SHARE_RECEIVED,
                    title    = f"{actor_name} shared a {resource_type} with you",
                    message  = f'"{resource_title}" has been shared with you ({permission_level} access)',
                    url      = view_url,
                    priority = 2,
                    metadata = {
                        "type":          "share_received",
                        "actor":         shared_by_email,
                        "resource_type": resource_type,
                        "resource_name": resource_title,
                        "resource_id":   resource_id,
                        "permission":    permission_level,
                        "timestamp":     datetime.utcnow().isoformat(),
                    },
                )
            except Exception as _notif_err:
                logger.warning(f"[share] Notification skipped for {recipient_email}: {_notif_err}")
            # —— /Notification ——

            email_sent = send_share_notification_email(
                recipient_email=recipient_email,
                document_title=resource_title,
                shared_by_email=shared_by_email,
                share_url=share_url,
                message=share_message
            )
            
            results.append({
                'email': recipient_email,
                'status': 'shared' if email_sent else 'warn',
                'message': 'Shared successfully' if email_sent else 'Shared (email failed)',
                'permission': permission_level
            })
            
        if resource_type.lower() == 'document':
            DocumentActivity.log_activity(
                resource_id, shared_by_email, 'shared_bulk',
                f'Documento compartido con {len(emails)} usuarios', request
            )
            
        logger.info(f"Recurso {resource_type} {resource_id} compartido por {shared_by_email} con {len(results)} usuarios")
        
        return jsonify({
            'status': 'success',
            'results': results,
            'message': f'Shared with {len([r for r in results if r["status"] in ["shared", "warn"]])} user(s)'
        })
        
    except Exception as e:
        logger.error(f"Error in bulk_share_resource: {e}")
        return jsonify({'error': 'Internal server error sharing resource'}), 500