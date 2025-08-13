from flask import Blueprint, request, jsonify, send_file
from datetime import datetime, timedelta
import json
import uuid
from io import BytesIO

from settings.extensions import db, limiter, logger
from models.models import Document, DocumentVersion, User, DocumentActivity
from settings.utils import (
    validate_delta, get_content_size, extract_and_upload_images,
    save_to_minio_compressed, load_from_minio_compressed,
    create_version_backup, export_to_pdf, export_to_docx,
    cache_document, get_cached_document, invalidate_document_cache,
    set_autosave_lock, get_autosave_lock
)

document_bp = Blueprint('documents', __name__)

@document_bp.route('/document', methods=['POST'])
@limiter.limit("30/minute")
def create_document():
    """Crear nuevo documento"""
    try:
        data = request.get_json() or {}
        title = data.get('title', 'Sin título')
        owner_email = data.get('owner_email')
        
        # Crear o obtener usuario si se proporciona email
        owner = None
        if owner_email:
            owner = User.get_or_create(owner_email)
        
        doc = Document(
            title=title,
            owner_id=owner.id if owner else None,
            document_type='created'
        )
        db.session.add(doc)
        db.session.commit()
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, user_email, 'restored', 
            f'Documento "{doc.title}" restaurado', request
        )
        
        logger.info(f"Documento {doc_id} restaurado por {user_email}")
        
        return jsonify({
            'status': 'restored',
            'message': 'Documento restaurado correctamente'
        })
        
    except Exception as e:
        logger.error(f"Error restaurando documento {doc_id}: {e}")
        return jsonify({'error': 'Error restaurando documento'}), 500

@document_bp.route('/document/<int:doc_id>/export/<format_type>', methods=['GET'])
@limiter.limit("20/minute")
def export_document(doc_id, format_type):
    """Exportar documento a PDF o DOCX"""
    try:
        if format_type not in ['pdf', 'docx']:
            return jsonify({'error': 'Formato no soportado'}), 400
        
        user_email = request.args.get('user_email', 'anonymous')
        
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Cargar contenido
        if doc.storage_type == 'database':
            html = doc.content_html or ''
        else:
            delta, html = load_from_minio_compressed(doc.minio_path)
            if html is None:
                return jsonify({'error': 'Error cargando documento'}), 500
        
        # Generar archivo
        if format_type == 'pdf':
            file_buffer = export_to_pdf(html, doc.title)
            mimetype = 'application/pdf'
            filename = f"{doc.title}.pdf"
        else:  # docx
            file_buffer = export_to_docx(html, doc.title)
            mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            filename = f"{doc.title}.docx"
        
        if not file_buffer:
            return jsonify({'error': 'Error generando archivo'}), 500
        
        try:
            from settings.extensions import minio_client
            
            # Guardar en Minio para descarga
            export_filename = f"{doc_id}_{uuid.uuid4().hex}.{format_type}"
            
            minio_client.put_object(
                bucket_name='exports',
                object_name=export_filename,
                data=file_buffer,
                length=file_buffer.getbuffer().nbytes,
                content_type=mimetype
            )
            
            # Generar URL de descarga temporal
            download_url = minio_client.presigned_get_object(
                'exports', 
                export_filename, 
                expires=timedelta(hours=1)
            )
            
            # Registrar actividad
            DocumentActivity.log_activity(
                doc_id, user_email, 'exported', 
                f'Documento exportado a {format_type.upper()}', request
            )
            
            logger.info(f"Documento {doc_id} exportado a {format_type} por {user_email}")
            
            return jsonify({
                'download_url': download_url,
                'filename': filename,
                'format': format_type,
                'expires_in': '1 hora'
            })
            
        except Exception as e:
            logger.error(f"Error exportando documento: {e}")
            return jsonify({'error': 'Error generando exportación'}), 500
        
    except Exception as e:
        logger.error(f"Error en exportación: {e}")
        return jsonify({'error': 'Error en exportación'}), 500

@document_bp.route('/image/<filename>')
def serve_image(filename):
    """Servir imágenes desde Minio"""
    try:
        from settings.extensions import minio_client
        
        response = minio_client.get_object('images', filename)
        
        # Determinar tipo de contenido
        content_type = 'image/png'  # por defecto
        if filename.lower().endswith(('.jpg', '.jpeg')):
            content_type = 'image/jpeg'
        elif filename.lower().endswith('.gif'):
            content_type = 'image/gif'
        elif filename.lower().endswith('.webp'):
            content_type = 'image/webp'
        
        return send_file(
            BytesIO(response.read()),
            mimetype=content_type,
            as_attachment=False
        )
        
    except Exception as e:
        logger.error(f"Error sirviendo imagen {filename}: {e}")
        return jsonify({'error': 'Imagen no encontrada'}), 404

@document_bp.route('/documents', methods=['GET'])
def list_documents():
    """Listar documentos con filtros y paginación"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        owner_email = request.args.get('owner_email')
        include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
        search = request.args.get('search', '').strip()
        
        # Construir query
        query = Document.query
        
        # Filtro por propietario
        if owner_email:
            user = User.query.filter_by(email=owner_email).first()
            if user:
                query = query.filter(Document.owner_id == user.id)
            else:
                # Si el usuario no existe, no hay documentos
                return jsonify({
                    'documents': [],
                    'total': 0,
                    'pages': 0,
                    'current_page': page
                })
        
        # Filtro por documentos eliminados
        if not include_deleted:
            query = query.filter(Document.is_deleted == False)
        
        # Búsqueda por título
        if search:
            query = query.filter(Document.title.contains(search))
        
        # Ordenar por fecha de actualización
        query = query.order_by(Document.updated_at.desc())
        
        # Paginar
        docs = query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        # Convertir a dict
        documents = []
        for doc in docs.items:
            doc_data = doc.to_dict()
            doc_data['can_restore'] = doc.is_deleted
            documents.append(doc_data)
        
        return jsonify({
            'documents': documents,
            'total': docs.total,
            'pages': docs.pages,
            'current_page': page,
            'per_page': per_page,
            'has_next': docs.has_next,
            'has_prev': docs.has_prev
        })
        
    except Exception as e:
        logger.error(f"Error listando documentos: {e}")
        return jsonify({'error': 'Error cargando documentos'}), 500

@document_bp.route('/document/<int:doc_id>/versions', methods=['GET'])
def list_document_versions(doc_id):
    """Listar versiones de un documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        
        versions = DocumentVersion.query.filter_by(document_id=doc_id)\
            .order_by(DocumentVersion.created_at.desc()).all()
        
        return jsonify({
            'document_id': doc_id,
            'document_title': doc.title,
            'current_version': doc.version_number,
            'versions': [version.to_dict() for version in versions]
        })
        
    except Exception as e:
        logger.error(f"Error listando versiones: {e}")
        return jsonify({'error': 'Error cargando versiones'}), 500

@document_bp.route('/document/<int:doc_id>/version/<int:version_id>/restore', methods=['POST'])
@limiter.limit("5/minute")
def restore_document_version(doc_id, version_id):
    """Restaurar una versión específica del documento"""
    try:
        user_email = request.args.get('user_email', 'anonymous')
        
        doc = Document.query.get_or_404(doc_id)
        version = DocumentVersion.query.get_or_404(version_id)
        
        if version.document_id != doc_id:
            return jsonify({'error': 'Versión no pertenece al documento'}), 400
        
        # Crear respaldo de la versión actual
        create_version_backup(doc)
        
        # Restaurar contenido de la versión
        if version.minio_path:
            delta, html = load_from_minio_compressed(version.minio_path)
        else:
            delta = json.loads(version.content_delta) if version.content_delta else {}
            html = ''
        
        # Actualizar documento
        content_size = get_content_size(delta, html)
        doc.content_delta = json.dumps(delta)
        doc.content_html = html
        doc.storage_type = 'database'  # Restaurar a base de datos por simplicidad
        doc.size_bytes = content_size
        doc.version_number += 1
        doc.updated_at = datetime.utcnow()
        
        # Limpiar ruta de Minio si existía
        if doc.minio_path:
            doc.minio_path = None
        
        db.session.commit()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, user_email, 'version_restored', 
            f'Restaurada versión {version.version_number}', request
        )
        
        logger.info(f"Versión {version_id} restaurada para documento {doc_id}")
        
        return jsonify({
            'status': 'version_restored',
            'message': f'Versión {version.version_number} restaurada correctamente',
            'new_version': doc.version_number
        })
        
    except Exception as e:
        logger.error(f"Error restaurando versión: {e}")
        return jsonify({'error': 'Error restaurando versión'}), 500

@document_bp.route('/document/<int:doc_id>/activity', methods=['GET'])
def get_document_activity(doc_id):
    """Obtener historial de actividad del documento"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 50, type=int), 100)
        
        doc = Document.query.get_or_404(doc_id)
        
        activities = DocumentActivity.query.filter_by(document_id=doc_id)\
            .order_by(DocumentActivity.created_at.desc())\
            .paginate(page=page, per_page=per_page, error_out=False)
        
        return jsonify({
            'document_id': doc_id,
            'document_title': doc.title,
            'activities': [activity.to_dict() for activity in activities.items],
            'total': activities.total,
            'pages': activities.pages,
            'current_page': page
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo actividad: {e}")
        return jsonify({'error': 'Error cargando actividad'}), 500

@document_bp.route('/stats', methods=['GET'])
def get_stats():
    """Estadísticas del sistema"""
    try:
        owner_email = request.args.get('owner_email')
        
        # Estadísticas generales o por usuario
        if owner_email:
            user = User.query.filter_by(email=owner_email).first()
            if user:
                total_docs = Document.query.filter_by(owner_id=user.id, is_deleted=False).count()
                deleted_docs = Document.query.filter_by(owner_id=user.id, is_deleted=True).count()
                total_size = db.session.query(db.func.sum(Document.size_bytes))\
                    .filter_by(owner_id=user.id, is_deleted=False).scalar() or 0
            else:
                total_docs = deleted_docs = total_size = 0
        else:
            total_docs = Document.query.filter_by(is_deleted=False).count()
            deleted_docs = Document.query.filter_by(is_deleted=True).count()
            total_size = db.session.query(db.func.sum(Document.size_bytes))\
                .filter_by(is_deleted=False).scalar() or 0
        
        # Estadísticas por tipo de almacenamiento
        db_docs = Document.query.filter_by(storage_type='database', is_deleted=False).count()
        minio_docs = Document.query.filter_by(storage_type='minio', is_deleted=False).count()
        
        # Estadísticas por tipo de documento
        created_docs = Document.query.filter_by(document_type='created', is_deleted=False).count()
        uploaded_docs = Document.query.filter_by(document_type='uploaded', is_deleted=False).count()
        
        return jsonify({
            'total_documents': total_docs,
            'deleted_documents': deleted_docs,
            'database_documents': db_docs,
            'minio_documents': minio_docs,
            'created_documents': created_docs,
            'uploaded_documents': uploaded_docs,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2),
            'owner_email': owner_email
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500(
            doc.id, 
            owner_email or 'anonymous', 
            'created', 
            f'Documento "{title}" creado',
            request
        )
        
        logger.info(f"Documento creado: ID {doc.id}, título: {title}")
        
        return jsonify({
            'id': doc.id,
            'title': doc.title,
            'created_at': doc.created_at.isoformat(),
            'owner_email': owner.email if owner else None
        })
        
    except Exception as e:
        logger.error(f"Error creando documento: {e}")
        return jsonify({'error': 'Error creando documento'}), 500

@document_bp.route('/document/<int:doc_id>/save', methods=['POST'])
@limiter.limit("100/minute")
def save_document(doc_id):
    """Guardar documento con sistema híbrido y auto-guardado"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No se enviaron datos'}), 400
        
        delta = data.get('delta')
        html = data.get('html')
        title = data.get('title', 'Sin título')
        user_email = data.get('user_email', 'anonymous')
        is_autosave = data.get('is_autosave', False)
        
        if not delta:
            return jsonify({'error': 'Delta requerido'}), 400
        
        # Validar delta
        is_valid, message = validate_delta(delta)
        if not is_valid:
            return jsonify({'error': message}), 400
        
        # Buscar documento
        doc = Document.query.get_or_404(doc_id)
        
        # Verificar bloqueo de auto-guardado
        if is_autosave:
            existing_lock = get_autosave_lock(doc_id)
            if existing_lock and existing_lock.get('user_email') != user_email:
                return jsonify({
                    'error': 'Documento siendo editado por otro usuario',
                    'locked_by': existing_lock.get('user_email')
                }), 409
            
            # Establecer bloqueo
            set_autosave_lock(doc_id, user_email)
        
        # Crear respaldo de versión antes de modificar (solo si no es auto-guardado)
        if not is_autosave:
            create_version_backup(doc)
        
        # Procesar imágenes
        delta = extract_and_upload_images(delta)
        
        # Actualizar documento
        doc.title = title
        content_size = get_content_size(delta, html)
        doc.size_bytes = content_size
        doc.updated_at = datetime.utcnow()
        
        # Decidir almacenamiento basado en tamaño
        from flask import current_app
        
        if content_size <= current_app.config['MAX_DB_SIZE']:
            # Guardar en base de datos
            doc.content_delta = json.dumps(delta)
            doc.content_html = html
            doc.storage_type = 'database'
            
            # Limpiar Minio si existía
            if doc.minio_path:
                try:
                    from settings.extensions import minio_client
                    minio_client.remove_object('documents', doc.minio_path)
                except:
                    pass
                doc.minio_path = None
        else:
            # Guardar en Minio
            minio_path = save_to_minio_compressed(delta, html)
            doc.minio_path = minio_path
            doc.storage_type = 'minio'
            doc.content_delta = None
            doc.content_html = None
        
        db.session.commit()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad (solo si no es auto-guardado)
        if not is_autosave:
            DocumentActivity.log_activity(
                doc_id, 
                user_email, 
                'updated', 
                f'Documento actualizado manualmente',
                request
            )
        
        logger.info(f"Documento {doc_id} guardado en {doc.storage_type}, tamaño: {content_size}")
        
        return jsonify({
            'status': 'saved',
            'storage_type': doc.storage_type,
            'size_bytes': content_size,
            'updated_at': doc.updated_at.isoformat(),
            'is_autosave': is_autosave
        })
        
    except Exception as e:
        logger.error(f"Error guardando documento {doc_id}: {e}")
        return jsonify({'error': 'Error guardando documento'}), 500

@document_bp.route('/document/<int:doc_id>/load', methods=['GET'])
def load_document(doc_id):
    """Cargar documento con cache"""
    try:
        user_email = request.args.get('user_email', 'anonymous')
        
        # Verificar cache primero
        cached_doc = get_cached_document(doc_id)
        if cached_doc:
            # Registrar acceso
            DocumentActivity.log_activity(
                doc_id, user_email, 'viewed', 'Documento accedido (cache)', request
            )
            return jsonify(cached_doc)
        
        # Cargar desde base de datos
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        if doc.storage_type == 'database':
            delta = json.loads(doc.content_delta) if doc.content_delta else {}
            html = doc.content_html or ''
        else:
            delta, html = load_from_minio_compressed(doc.minio_path)
            if delta is None:
                return jsonify({'error': 'Error cargando desde almacenamiento'}), 500
        
        # Preparar respuesta
        response_data = {
            'id': doc.id,
            'title': doc.title,
            'delta': delta,
            'html': html,
            'storage_type': doc.storage_type,
            'size_bytes': doc.size_bytes,
            'document_type': doc.document_type,
            'original_filename': doc.original_filename,
            'version_number': doc.version_number,
            'created_at': doc.created_at.isoformat(),
            'updated_at': doc.updated_at.isoformat(),
            'owner_email': doc.owner.email if doc.owner else None
        }
        
        # Cachear documento
        cache_document(doc_id, response_data)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, user_email, 'viewed', 'Documento cargado', request
        )
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error cargando documento {doc_id}: {e}")
        return jsonify({'error': 'Error cargando documento'}), 500

@document_bp.route('/document/<int:doc_id>/delete', methods=['DELETE'])
@limiter.limit("10/minute")
def delete_document(doc_id):
    """Borrado suave de documento"""
    try:
        user_email = request.args.get('user_email', 'anonymous')
        
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento ya está eliminado'}), 400
        
        # Realizar borrado suave
        doc.soft_delete()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, user_email, 'deleted', 
            f'Documento "{doc.title}" eliminado', request
        )
        
        logger.info(f"Documento {doc_id} eliminado por {user_email}")
        
        return jsonify({
            'status': 'deleted',
            'message': 'Documento eliminado correctamente',
            'deleted_at': doc.deleted_at.isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error eliminando documento {doc_id}: {e}")
        return jsonify({'error': 'Error eliminando documento'}), 500

#@document_bp.route('/document/<int:doc_id>/restore', methods=['POST'])
#@limiter.limit("10/minute")
#def restore_document(doc_id):
#    """Restaurar documento eliminado"""
#    try:
#        user_email = request.args.get('user_email', 'anonymous')
        
#        doc = Document.query.get_or_404(doc_id)
        
#        if not doc.is_deleted:
#            return jsonify({'error': 'Documento no está eliminado'}), 400
        
        # Restaurar documento
#        doc.restore()
        
        # Registrar actividad
#        DocumentActivity.log_activity