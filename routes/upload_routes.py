from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
import os
import uuid
from datetime import datetime

from settings.extensions import db, limiter, logger
from models.models import Document, User, DocumentActivity
from settings.utils import (
    allowed_file, generate_safe_filename, process_docx_upload,
    get_content_size, validate_email
)

upload_bp = Blueprint('upload', __name__)

@upload_bp.route('/document/upload', methods=['POST'])
@limiter.limit("10/minute")
def upload_document():
    """Subir documento DOCX/DOC y convertir a formato del editor"""
    try:
        # Verificar que se subió un archivo
        if 'file' not in request.files:
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        # Obtener metadatos adicionales
        owner_email = request.form.get('owner_email', '').strip()
        custom_title = request.form.get('title', '').strip()
        
        # Validar email del propietario si se proporciona
        owner = None
        if owner_email:
            if not validate_email(owner_email):
                return jsonify({'error': 'Email del propietario no válido'}), 400
            owner = User.get_or_create(owner_email)
        
        # Validar archivo
        if not allowed_file(file.filename, {'doc', 'docx'}):
            return jsonify({
                'error': 'Tipo de archivo no soportado. Solo se permiten archivos .doc y .docx'
            }), 400
        
        # Verificar tamaño del archivo
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        from flask import current_app
        if file_size > current_app.config['MAX_CONTENT_LENGTH']:
            max_size_mb = current_app.config['MAX_CONTENT_LENGTH'] / (1024 * 1024)
            return jsonify({
                'error': f'Archivo demasiado grande. Máximo {max_size_mb:.1f}MB'
            }), 400
        
        # Generar nombre seguro para el archivo
        original_filename = secure_filename(file.filename)
        safe_filename = generate_safe_filename(original_filename)
        
        # Guardar archivo temporalmente
        upload_folder = current_app.config['UPLOAD_FOLDER']
        os.makedirs(upload_folder, exist_ok=True)
        
        temp_file_path = os.path.join(upload_folder, safe_filename)
        file.save(temp_file_path)
        
        try:
            # Procesar archivo según extensión
            file_ext = original_filename.rsplit('.', 1)[1].lower()
            
            if file_ext in ['docx', 'doc']:
                delta, html, error = process_docx_upload(temp_file_path)
                
                if error:
                    return jsonify({'error': f'Error procesando documento: {error}'}), 400
                
                if not delta or not html:
                    return jsonify({'error': 'No se pudo extraer contenido del documento'}), 400
            
            else:
                return jsonify({'error': 'Formato de archivo no soportado'}), 400
            
            # Determinar título del documento
            if custom_title:
                doc_title = custom_title
            else:
                # Usar nombre del archivo sin extensión
                doc_title = original_filename.rsplit('.', 1)[0]
            
            # Crear documento en la base de datos
            doc = Document(
                title=doc_title,
                document_type='uploaded',
                original_filename=original_filename,
                mime_type=f'application/vnd.openxmlformats-officedocument.wordprocessingml.document' if file_ext == 'docx' else 'application/msword',
                owner_id=owner.id if owner else None
            )
            
            # Calcular tamaño del contenido
            content_size = get_content_size(delta, html)
            doc.size_bytes = content_size
            
            # Decidir almacenamiento
            if content_size <= current_app.config['MAX_DB_SIZE']:
                # Guardar en base de datos
                import json
                doc.content_delta = json.dumps(delta)
                doc.content_html = html
                doc.storage_type = 'database'
            else:
                # Guardar en Minio
                from settings.utils import save_to_minio_compressed
                minio_path = save_to_minio_compressed(delta, html)
                doc.minio_path = minio_path
                doc.storage_type = 'minio'
            
            db.session.add(doc)
            db.session.commit()
            
            # Registrar actividad
            DocumentActivity.log_activity(
                doc.id, 
                owner_email or 'anonymous', 
                'uploaded', 
                f'Documento "{original_filename}" subido y convertido',
                request
            )
            
            logger.info(f"Documento subido: ID {doc.id}, archivo: {original_filename}, tamaño: {content_size}")
            
            return jsonify({
                'id': doc.id,
                'title': doc.title,
                'original_filename': original_filename,
                'document_type': 'uploaded',
                'storage_type': doc.storage_type,
                'size_bytes': content_size,
                'created_at': doc.created_at.isoformat(),
                'owner_email': owner.email if owner else None,
                'message': f'Documento "{original_filename}" subido y convertido exitosamente'
            })
            
        finally:
            # Limpiar archivo temporal
            try:
                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
            except:
                pass
        
    except Exception as e:
        logger.error(f"Error subiendo documento: {e}")
        return jsonify({'error': 'Error procesando archivo'}), 500

@upload_bp.route('/document/<int:doc_id>/replace', methods=['POST'])
@limiter.limit("5/minute")
def replace_document_content(doc_id):
    """Reemplazar contenido de un documento existente con archivo subido"""
    try:
        # Verificar que se subió un archivo
        if 'file' not in request.files:
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        # Obtener metadatos
        user_email = request.form.get('user_email', 'anonymous')
        keep_title = request.form.get('keep_title', 'true').lower() == 'true'
        
        # Buscar documento existente
        doc = Document.query.get_or_404(doc_id)
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Validar archivo
        if not allowed_file(file.filename, {'doc', 'docx'}):
            return jsonify({
                'error': 'Tipo de archivo no soportado. Solo se permiten archivos .doc y .docx'
            }), 400
        
        # Verificar tamaño
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        from flask import current_app
        if file_size > current_app.config['MAX_CONTENT_LENGTH']:
            max_size_mb = current_app.config['MAX_CONTENT_LENGTH'] / (1024 * 1024)
            return jsonify({
                'error': f'Archivo demasiado grande. Máximo {max_size_mb:.1f}MB'
            }), 400
        
        # Crear respaldo de versión actual
        from settings.utils import create_version_backup
        create_version_backup(doc)
        
        # Procesar archivo
        original_filename = secure_filename(file.filename)
        safe_filename = generate_safe_filename(original_filename)
        
        upload_folder = current_app.config['UPLOAD_FOLDER']
        temp_file_path = os.path.join(upload_folder, safe_filename)
        file.save(temp_file_path)
        
        try:
            # Procesar contenido
            file_ext = original_filename.rsplit('.', 1)[1].lower()
            
            if file_ext in ['docx', 'doc']:
                delta, html, error = process_docx_upload(temp_file_path)
                
                if error:
                    return jsonify({'error': f'Error procesando documento: {error}'}), 400
            else:
                return jsonify({'error': 'Formato no soportado'}), 400
            
            # Actualizar documento
            if not keep_title:
                doc.title = original_filename.rsplit('.', 1)[0]
            
            doc.original_filename = original_filename
            doc.mime_type = f'application/vnd.openxmlformats-officedocument.wordprocessingml.document' if file_ext == 'docx' else 'application/msword'
            doc.document_type = 'uploaded'
            doc.updated_at = datetime.utcnow()
            doc.version_number += 1
            
            # Actualizar contenido
            content_size = get_content_size(delta, html)
            doc.size_bytes = content_size
            
            # Limpiar almacenamiento anterior si estaba en Minio
            if doc.minio_path:
                try:
                    from settings.extensions import minio_client
                    minio_client.remove_object('documents', doc.minio_path)
                except:
                    pass
                doc.minio_path = None
            
            # Decidir nuevo almacenamiento
            if content_size <= current_app.config['MAX_DB_SIZE']:
                import json
                doc.content_delta = json.dumps(delta)
                doc.content_html = html
                doc.storage_type = 'database'
            else:
                from settings.utils import save_to_minio_compressed
                minio_path = save_to_minio_compressed(delta, html)
                doc.minio_path = minio_path
                doc.storage_type = 'minio'
                doc.content_delta = None
                doc.content_html = None
            
            db.session.commit()
            
            # Invalidar cache
            from settings.utils import invalidate_document_cache
            invalidate_document_cache(doc_id)
            
            # Registrar actividad
            DocumentActivity.log_activity(
                doc_id, user_email, 'content_replaced', 
                f'Contenido reemplazado con archivo "{original_filename}"',
                request
            )
            
            logger.info(f"Contenido de documento {doc_id} reemplazado con {original_filename}")
            
            return jsonify({
                'id': doc.id,
                'title': doc.title,
                'original_filename': original_filename,
                'storage_type': doc.storage_type,
                'size_bytes': content_size,
                'version_number': doc.version_number,
                'updated_at': doc.updated_at.isoformat(),
                'message': f'Contenido reemplazado con "{original_filename}" exitosamente'
            })
            
        finally:
            # Limpiar archivo temporal
            try:
                if os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
            except:
                pass
        
    except Exception as e:
        logger.error(f"Error reemplazando contenido: {e}")
        return jsonify({'error': 'Error procesando reemplazo'}), 500

@upload_bp.route('/upload/validate', methods=['POST'])
def validate_upload():
    """Validar archivo antes de subirlo (para preview)"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No se seleccionó archivo'}), 400
        
        original_filename = secure_filename(file.filename)
        file_ext = original_filename.rsplit('.', 1)[1].lower() if '.' in original_filename else ''
        
        # Verificar extensión
        if file_ext not in ['doc', 'docx']:
            return jsonify({
                'valid': False,
                'error': 'Tipo de archivo no soportado. Solo se permiten archivos .doc y .docx'
            }), 200
        
        # Verificar tamaño
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        from flask import current_app
        max_size = current_app.config['MAX_CONTENT_LENGTH']
        
        if file_size > max_size:
            max_size_mb = max_size / (1024 * 1024)
            return jsonify({
                'valid': False,
                'error': f'Archivo demasiado grande. Máximo {max_size_mb:.1f}MB, actual: {file_size / (1024 * 1024):.1f}MB'
            }), 200
        
        # Validación exitosa
        return jsonify({
            'valid': True,
            'filename': original_filename,
            'size_bytes': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2),
            'file_type': file_ext,
            'mime_type': f'application/vnd.openxmlformats-officedocument.wordprocessingml.document' if file_ext == 'docx' else 'application/msword'
        })
        
    except Exception as e:
        logger.error(f"Error validando archivo: {e}")
        return jsonify({'error': 'Error validando archivo'}), 500

@upload_bp.route('/upload/stats', methods=['GET'])
def get_upload_stats():
    """Obtener estadísticas de documentos subidos"""
    try:
        owner_email = request.args.get('owner_email')
        
        # Construir query base
        query = Document.query.filter_by(document_type='uploaded', is_deleted=False)
        
        if owner_email:
            user = User.query.filter_by(email=owner_email).first()
            if user:
                query = query.filter_by(owner_id=user.id)
            else:
                return jsonify({
                    'total_uploaded': 0,
                    'total_size_bytes': 0,
                    'total_size_mb': 0,
                    'by_format': {},
                    'recent_uploads': [],
                    'owner_email': owner_email
                })
        
        # Estadísticas generales
        total_uploaded = query.count()
        total_size = db.session.query(db.func.sum(Document.size_bytes))\
            .filter_by(document_type='uploaded', is_deleted=False)
        
        if owner_email and user:
            total_size = total_size.filter_by(owner_id=user.id)
        
        total_size = total_size.scalar() or 0
        
        # Estadísticas por formato
        from sqlalchemy import func
        format_stats = db.session.query(
            Document.mime_type,
            func.count(Document.id).label('count'),
            func.sum(Document.size_bytes).label('total_size')
        ).filter_by(document_type='uploaded', is_deleted=False)
        
        if owner_email and user:
            format_stats = format_stats.filter_by(owner_id=user.id)
        
        format_stats = format_stats.group_by(Document.mime_type).all()
        
        # Documentos subidos recientemente
        recent_query = query.order_by(Document.created_at.desc()).limit(10)
        recent_uploads = recent_query.all()
        
        return jsonify({
            'total_uploaded': total_uploaded,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2),
            'by_format': {
                'DOCX' if 'wordprocessingml' in fmt else 'DOC': {
                    'count': count,
                    'size_bytes': size,
                    'size_mb': round(size / (1024 * 1024), 2)
                } for fmt, count, size in format_stats
            },
            'recent_uploads': [
                {
                    'id': doc.id,
                    'title': doc.title,
                    'original_filename': doc.original_filename,
                    'size_bytes': doc.size_bytes,
                    'created_at': doc.created_at.isoformat(),
                    'owner_email': doc.owner.email if doc.owner else None
                } for doc in recent_uploads
            ],
            'owner_email': owner_email
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de upload: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500