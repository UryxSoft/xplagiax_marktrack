from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
import os
import uuid
from datetime import datetime

from settings.extensions import db, limiter, logger
from flask_login import login_required, current_user
from models.models import Document, User, DocumentActivity
from settings.utils import (
    allowed_file, generate_safe_filename, process_docx_upload,
    get_content_size, validate_email
)

upload_bp = Blueprint('upload', __name__)

@upload_bp.route('/api/document/upload', methods=['POST'])
@login_required
@limiter.limit("10/minute")
def upload_document():
    """Subir documento DOCX/DOC y convertir a formato del editor"""
    #try:
        # Verificar que se subió un archivo
    if 'file' not in request.files:
        return jsonify({'error': 'No se seleccionó archivo'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó archivo'}), 400
    
    # Optional custom title from form
    custom_title = request.form.get('title', '').strip()
    
    # Optional folder_id from form
    folder_id = request.form.get('folder_id')
    if folder_id:
        try:
            folder_id = int(folder_id)
            from models.models import Folder
            if not Folder.query.filter_by(id=folder_id, user_id=current_user.id).first():
                return jsonify({'error': 'Carpeta destino no encontrada o no autorizada'}), 404
        except ValueError:
            folder_id = None
    
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
            owner_id=current_user.id,
            folder_id=folder_id
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
            current_user.email, 
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
            'owner_id': current_user.id,
            'message': f'Documento "{original_filename}" subido y convertido exitosamente'
        })
        
    finally:
        # Limpiar archivo temporal
        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except:
            pass
        
    #except Exception as e:
    #    logger.error(f"Error subiendo documento: {e}")
    #    return jsonify({'error': 'Error procesando archivo'}), 500

@upload_bp.route('/api/image/upload', methods=['POST'])
@limiter.limit("20/minute")
def upload_image():
    """Subir imagen a SeaweedFS y retornar URL"""
    if 'file' not in request.files:
        return jsonify({'error': 'No se seleccionó archivo'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No se seleccionó archivo'}), 400
    
    # Validar extensión de imagen
    if not allowed_file(file.filename, {'png', 'jpg', 'jpeg', 'gif', 'webp'}):
        return jsonify({'error': 'Formato de imagen no soportado'}), 400
    
    try:
        from settings.utils import optimize_image
        from settings.extensions import minio_client
        from io import BytesIO
        
        image_bytes = file.read()
        if not image_bytes:
            return jsonify({'error': 'Contenido de imagen vacío'}), 400
            
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'png'
        
        # Generar nombre único
        filename = f"{uuid.uuid4()}.{file_ext}"
        
        logger.info(f"[UploadImage] Procesando imagen: {filename}, tamaño: {len(image_bytes)}")
        
        # Optimizar imagen
        try:
            optimized_bytes = optimize_image(image_bytes, file_ext)
        except Exception as opt_err:
            logger.warning(f"Error optimizando imagen, usando original: {opt_err}")
            optimized_bytes = image_bytes
        
        # Intentar subir a SeaweedFS con timeout corto
        try:
            # Subir a SeaweedFS
            minio_client.put_object(
                bucket_name='images',
                object_name=filename,
                data=BytesIO(optimized_bytes),
                length=len(optimized_bytes),
                content_type=f'image/{file_ext}'
            )
            logger.info(f"[UploadImage] Imagen subida a SeaweedFS: {filename}")
        except Exception as minio_err:
            logger.warning(f"[UploadImage] SeaweedFS no disponible, usando almacenamiento local: {minio_err}")
            
            # Almacenamiento local fallback
            from flask import current_app
            upload_folder = current_app.config['UPLOAD_FOLDER']
            images_dir = os.path.join(upload_folder, 'images')
            os.makedirs(images_dir, exist_ok=True)
            
            local_path = os.path.join(images_dir, filename)
            with open(local_path, 'wb') as f:
                f.write(optimized_bytes)
            
            logger.info(f"[UploadImage] Imagen guardada localmente: {local_path}")
        
        # Retornar URL que apunta al serve_image en document_bp
        url = f"/api/image/{filename}"
        
        return jsonify({
            'success': True,
            'url': url,
            'filename': filename,
            'message': 'Imagen subida exitosamente (fallback local activo si SeaweedFS falló)'
        })
        
    except Exception as e:
        logger.exception(f"Error crítico en subida de imagen: {e}")
        return jsonify({'error': f'Error interno: {str(e)}'}), 500

@upload_bp.route('/api/document/<int:doc_id>/replace', methods=['POST'])
@login_required
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
        keep_title = request.form.get('keep_title', 'true').lower() == 'true'
        
        # Buscar documento existente y verificar ownership
        doc = Document.query.get_or_404(doc_id)
        
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
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
                    if doc.minio_path.startswith('local://'):
                        import os
                        real_filename = doc.minio_path.replace('local://', '')
                        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'uploads')
                        local_path = os.path.join(upload_folder, 'documents', real_filename)
                        if os.path.exists(local_path):
                            os.remove(local_path)
                            logger.info(f"Archivo local eliminado (reemplazo): {real_filename}")
                    else:
                        minio_client.remove_object('documents', doc.minio_path)
                except Exception as rem_err:
                    logger.warning(f"Error eliminando objeto previo: {rem_err}")
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
                doc_id, current_user.email, 'content_replaced', 
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
@login_required
def get_upload_stats():
    """Obtener estadísticas de documentos subidos por el usuario autenticado"""
    try:
        # ALWAYS scoped to current user
        query = Document.query.filter_by(document_type='uploaded', is_deleted=False, owner_id=current_user.id)
        
        # Estadísticas generales
        total_uploaded = query.count()
        total_size = db.session.query(db.func.sum(Document.size_bytes))\
            .filter_by(document_type='uploaded', is_deleted=False, owner_id=current_user.id).scalar() or 0
        
        # Estadísticas por formato
        from sqlalchemy import func
        format_stats = db.session.query(
            Document.mime_type,
            func.count(Document.id).label('count'),
            func.sum(Document.size_bytes).label('total_size')
        ).filter_by(document_type='uploaded', is_deleted=False, owner_id=current_user.id)
        
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
            'owner_id': current_user.id
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas de upload: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500