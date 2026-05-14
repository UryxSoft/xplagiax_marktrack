from flask import Blueprint, request, jsonify, send_file, current_app
from flask_login import login_required, current_user
from datetime import datetime, timedelta
import json
import uuid
import os
from io import BytesIO

from settings.extensions import db, limiter, logger, csrf
from models.models import Document, DocumentVersion, User, DocumentActivity
from settings.utils import (
    validate_delta, get_content_size, extract_and_upload_images,
    save_to_minio_compressed, load_from_minio_compressed,
    create_version_backup, export_to_pdf, export_to_docx,
    cache_document, get_cached_document, invalidate_document_cache,
    set_autosave_lock, get_autosave_lock
)

document_bp = Blueprint('document_bp', __name__)

# Eliminar el `csrf.exempt(document_bp)` para mantener CSRF activo en rutas que modifican datos.

@document_bp.route('/api/document', methods=['POST'])
@login_required
def create_document():
    """Crear nuevo documento"""
    data = request.get_json() or {}
    title = data.get('title', 'Sin título')
    folder_id = data.get('folder_id')
    
    # Validar que si hay folder_id pertenezca al usuario
    if folder_id is not None:
        from models.models import Folder
        if not Folder.query.filter_by(id=folder_id, user_id=current_user.id).first():
            return jsonify({'error': 'Carpeta no encontrada o no autorizada'}), 404
    
    doc = Document(
        title=title,
        owner_id=current_user.id,
        document_type='created',
        folder_id=folder_id
    )
    db.session.add(doc)
    db.session.commit()
    
    logger.info(f"Documento creado: ID {doc.id}, título: {title}, owner: {current_user.id}")
    
    return jsonify({
        'id': doc.id,
        'title': doc.title,
        'created_at': doc.created_at.isoformat(),
        'owner_id': current_user.id
    })
    
    #except Exception as e:
    #    logger.error(f"Error restaurando documento {doc_id}: {e}")
    #    return jsonify({'error': 'Error restaurando documento'}), 500

@document_bp.route('/api/document/<int:doc_id>/export/<format_type>', methods=['GET'])
@login_required
@limiter.limit("20/minute")
def export_document(doc_id, format_type):
    """Exportar documento a PDF o DOCX"""
    if format_type not in ['pdf', 'docx']:
        return jsonify({'error': 'Formato no soportado'}), 400
    
    doc = Document.query.get_or_404(doc_id)
    
    # Verify ownership
    if doc.owner_id != current_user.id:
        return jsonify({'error': 'No autorizado'}), 403
    
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
            doc_id, current_user.email, 'exported', 
            f'Documento exportado a {format_type.upper()}', request
        )
        
        logger.info(f"Documento {doc_id} exportado a {format_type} por {current_user.email}")
        
        return jsonify({
            'download_url': download_url,
            'filename': filename,
            'format': format_type,
            'expires_in': '1 hora'
        })
        
    except Exception as e:
        logger.error(f"Error exportando documento: {e}")
        return jsonify({'error': 'Error generando exportación'}), 500
        
    #except Exception as e:
    #    logger.error(f"Error en exportación: {e}")
    #    return jsonify({'error': 'Error en exportación'}), 500

@document_bp.route('/api/image/<filename>')
def serve_image(filename):
    """Servir imágenes desde Minio"""
    try:
        from settings.extensions import minio_client
        
        try:
            response = minio_client.get_object('images', filename)
            data = response.read()
            logger.info(f"[ServeImage] Serving {filename} from Minio")
        except Exception as minio_err:
            logger.warning(f"[ServeImage] Minio error for {filename}, checking local: {minio_err}")
            
            # Fallback local paths
            fallback_paths = [
                os.path.join(current_app.config.get('UPLOAD_FOLDER', 'uploads'), 'images', filename),
                os.path.join(os.path.dirname(os.path.dirname(__file__)), 'uploads', 'images', filename),
                os.path.join(os.getcwd(), 'uploads', 'images', filename),
                os.path.join(os.getcwd(), 'static', 'uploads', 'images', filename)
            ]
            
            data = None
            for p in fallback_paths:
                if os.path.exists(p):
                    logger.info(f"[ServeImage] Found {filename} at {p}")
                    try:
                        with open(p, 'rb') as f:
                            data = f.read()
                        break
                    except Exception as e:
                        logger.error(f"[ServeImage] Error reading {p}: {e}")

            if data is None:
                logger.error(f"[ServeImage] Image {filename} not found in any location.")
                return jsonify({'error': 'Image not found'}), 404
        
        # Determinar tipo de contenido
        content_type = 'image/png'  # por defecto
        if filename.lower().endswith(('.jpg', '.jpeg')):
            content_type = 'image/jpeg'
        elif filename.lower().endswith('.gif'):
            content_type = 'image/gif'
        elif filename.lower().endswith('.webp'):
            content_type = 'image/webp'
        
        return send_file(
            BytesIO(data),
            mimetype=content_type,
            as_attachment=False
        )
        
    except Exception as e:
        logger.error(f"Error sirviendo imagen {filename}: {e}")
        return jsonify({'error': 'Imagen no encontrada'}), 404

@document_bp.route('/api/documents', methods=['GET'])
@login_required
def list_documents():
    """Listar documentos con filtros y paginación — scoped to current_user"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
        search = request.args.get('search', '').strip()
        
        folder_id = request.args.get('folder_id')
        
        # ALWAYS filter by authenticated user
        query = Document.query.filter(Document.owner_id == current_user.id)
        
        # Filter by folder_id
        if folder_id:
            if folder_id.lower() != 'all':
                try:
                    query = query.filter(Document.folder_id == int(folder_id))
                except ValueError:
                    pass
        elif not search:
            # Default to root documents if no folder_id and no global search
            query = query.filter(Document.folder_id.is_(None))
        
        # Filtro por documentos eliminados y archivados
        if not include_deleted:
            query = query.filter(Document.is_deleted == False)
            # Solo mostrar documentos no archivados en la vista principal
            query = query.filter(Document.is_archived == False)

        # Excluir documentos de workspace (solo se ven en el detalle del workspace)
        query = query.filter(Document.document_type != 'workspace')
        
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

@document_bp.route('/api/document/<int:doc_id>/versions', methods=['GET'])
@login_required
def list_document_versions(doc_id):
    """Listar versiones de un documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        versions = DocumentVersion.query.filter_by(document_id=doc_id).order_by(DocumentVersion.created_at.desc()).all()
        
        return jsonify({
            'document_id': doc_id,
            'document_title': doc.title,
            'current_version': doc.version_number,
            'versions': [version.to_dict() for version in versions]
        })
        
    except Exception as e:
        logger.error(f"Error listando versiones: {e}")
        return jsonify({'error': 'Error cargando versiones'}), 500

@document_bp.route('/api/document/<int:doc_id>/version/<int:version_id>/restore', methods=['POST'])
@login_required
@limiter.limit("5/minute")
def restore_document_version(doc_id, version_id):
    """Restaurar una versión específica del documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
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
            doc_id, current_user.email, 'version_restored', 
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

@document_bp.route('/api/document/<int:doc_id>/activity', methods=['GET'])
@login_required
def get_document_activity(doc_id):
    """Obtener historial de actividad del documento"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 50, type=int), 100)
        
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
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

@document_bp.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    """Estadísticas del usuario autenticado"""
    try:
        # ALWAYS scoped to current_user
        total_docs = Document.query.filter_by(owner_id=current_user.id, is_deleted=False).filter(Document.document_type != 'workspace').count()
        deleted_docs = Document.query.filter_by(owner_id=current_user.id, is_deleted=True).filter(Document.document_type != 'workspace').count()
        total_size = db.session.query(db.func.sum(Document.size_bytes))\
            .filter_by(owner_id=current_user.id, is_deleted=False).filter(Document.document_type != 'workspace').scalar() or 0
        
        # Estadísticas por tipo de almacenamiento (scoped)
        db_docs = Document.query.filter_by(owner_id=current_user.id, storage_type='database', is_deleted=False).count()
        minio_docs = Document.query.filter_by(owner_id=current_user.id, storage_type='minio', is_deleted=False).count()
        
        # Estadísticas por tipo de documento (scoped)
        created_docs = Document.query.filter_by(owner_id=current_user.id, document_type='created', is_deleted=False).count()
        uploaded_docs = Document.query.filter_by(owner_id=current_user.id, document_type='uploaded', is_deleted=False).count()
        
        return jsonify({
            'total_documents': total_docs,
            'deleted_documents': deleted_docs,
            'database_documents': db_docs,
            'minio_documents': minio_docs,
            'created_documents': created_docs,
            'uploaded_documents': uploaded_docs,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2),
            'owner_id': current_user.id
        })
        
    except Exception as e:
        logger.error(f"Error obteniendo estadísticas: {e}")
        return jsonify({'error': 'Error cargando estadísticas'}), 500

@document_bp.route('/api/document/<int:doc_id>/save', methods=['POST'])
@login_required
@limiter.limit("60/minute")
def save_document(doc_id):
    """Guardar documento con sistema híbrido y auto-guardado"""
    #try:
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'No se enviaron datos'}), 400
    
    delta = data.get('delta')
    html = data.get('html')
    title = data.get('title', 'Sin título')
    is_autosave = data.get('is_autosave', False)
    metrics_payload = data.get('metrics')
    
    if metrics_payload:
        from models.models import EssaySubmissionMetrics
        # UPSERT: Find existing metrics for this document or create new
        metrics_rec = EssaySubmissionMetrics.query.filter_by(document_id=doc_id).first()
        
        if not metrics_rec:
            metrics_rec = EssaySubmissionMetrics(document_id=doc_id)
            db.session.add(metrics_rec)

        # Update cumulative values
        metrics_rec.total_time_seconds = int(metrics_payload.get('totalTimeSeconds', 0) or 0)
        metrics_rec.effective_time_seconds = int(metrics_payload.get('effectiveTypingSeconds', 0) or 0)
        metrics_rec.keystrokes = int(metrics_payload.get('totalKeystrokes', 0) or 0)
        metrics_rec.backspaces = int(metrics_payload.get('backspacesCount', 0) or 0)
        metrics_rec.avg_hold_ms = float(metrics_payload.get('avgHoldTimeMs', 0) or 0)
        metrics_rec.avg_interkey_ms = float(metrics_payload.get('avgInterKeyMs', 0) or 0)
        metrics_rec.long_pauses = int(metrics_payload.get('longPausesCount', 0) or 0)
        metrics_rec.wpm = float(metrics_payload.get('approxWPM', 0) or 0)
        
        # Concatenate raw_logs (audit events only), limit to last 200
        new_logs = metrics_payload.get('rawLogs', [])
        if new_logs:
            existing_logs = metrics_rec.raw_logs or []
            combined = existing_logs + new_logs
            metrics_rec.raw_logs = combined[-200:]
        
        # Merge activity_by_minute
        new_abm = metrics_payload.get('activityByMinute', {})
        existing_abm = (metrics_rec.session_metadata or {}).get('activity_by_minute', {})
        merged_abm = dict(existing_abm)
        for k, v in new_abm.items():
            str_k = str(k)
            merged_abm[str_k] = max(int(merged_abm.get(str_k, 0)), int(v or 0))

        metrics_rec.session_metadata = {
            'medium_pauses': int(metrics_payload.get('mediumPausesCount', 0) or 0),
            'total_focus_seconds': int(metrics_payload.get('totalFocusSeconds', 0) or 0),
            'paste_count': int(metrics_payload.get('pasteCount', 0) or 0),
            'large_deletions': int(metrics_payload.get('largeDeletionsCount', 0) or 0),
            'longest_burst': int(metrics_payload.get('longestBurst', 0) or 0),
            'activity_by_minute': merged_abm,
        }
        metrics_rec.submitted_at = datetime.utcnow()
    
    if not delta:
        return jsonify({'error': 'Delta requerido'}), 400
    
    # Validar delta
    is_valid, message = validate_delta(delta)
    if not is_valid:
        return jsonify({'error': message}), 400
    
    # Buscar documento y verificar ownership
    doc = Document.query.get_or_404(doc_id)
    if doc.owner_id != current_user.id:
        return jsonify({'error': 'No autorizado'}), 403
    
    # Verificar bloqueo de auto-guardado
    if is_autosave:
        existing_lock = get_autosave_lock(doc_id)
        if existing_lock and existing_lock.get('user_email') != current_user.email:
            return jsonify({
                'error': 'Documento siendo editado por otro usuario',
                'locked_by': existing_lock.get('user_email')
            }), 409
        
        # Establecer bloqueo
        set_autosave_lock(doc_id, current_user.email)
    
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
            current_user.email, 
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
    
    #except Exception as e:
    #    logger.error(f"Error guardando documento {doc_id}: {e}")
    #    return jsonify({'error': 'Error guardando documento'}), 500

@document_bp.route('/api/document/<int:doc_id>/load', methods=['GET'])
@login_required
def load_document(doc_id):
    """Cargar documento con cache"""
    try:
        # Cargar desde base de datos first to verify ownership
        doc = Document.query.get_or_404(doc_id)
        
        # Verify ownership (allow shared access via share token if needed)
        if doc.owner_id != current_user.id:
            # Check if user has share access
            from models.models import DocumentShare
            share_access = DocumentShare.query.filter_by(
                document_id=doc_id,
                user_id=current_user.id,
                is_active=True
            ).first()
            if not share_access:
                return jsonify({'error': 'No autorizado'}), 403
        
        if doc.is_deleted:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Verificar cache
        cached_doc = get_cached_document(doc_id)
        if cached_doc:
            DocumentActivity.log_activity(
                doc_id, current_user.email, 'viewed', 'Documento accedido (cache)', request
            )
            return jsonify(cached_doc)
        
        if doc.storage_type == 'database':
            delta = json.loads(doc.content_delta) if doc.content_delta else {}
            html  = doc.content_html or ''
        else:
            # Try minio / local file first
            delta, html = load_from_minio_compressed(doc.minio_path)
            if delta is None:
                # File is missing from storage — fall back to DB content_delta
                logger.warning(
                    f"[load_document] Storage file missing for doc {doc_id} "
                    f"(path={doc.minio_path}). Falling back to DB content."
                )
                delta = json.loads(doc.content_delta) if doc.content_delta else {"ops": [{"insert": "\n"}]}
                html  = doc.content_html or ''
        
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
            doc_id, current_user.email, 'viewed', 'Documento cargado', request
        )
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error cargando documento {doc_id}: {e}")
        return jsonify({'error': 'Error cargando documento'}), 500

@document_bp.route('/api/document/<int:doc_id>/rename', methods=['PUT'])
@login_required
@limiter.limit("20/minute")
def rename_document(doc_id):
    """Renombrar documento"""
    try:
        data = request.get_json()
        
        if not data or 'title' not in data:
            return jsonify({'error': 'Se requiere el nuevo título'}), 400
            
        new_title = data['title'].strip()
        if not new_title:
            return jsonify({'error': 'El título no puede estar vacío'}), 400
            
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        old_title = doc.title
        doc.title = new_title
        doc.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        # Invalidar cache si existe
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, current_user.email, 'renamed', 
            f'Documento renombrado de "{old_title}" a "{new_title}"', request
        )
        
        return jsonify({
            'status': 'success',
            'message': 'Documento renombrado correctamente',
            'id': doc.id,
            'title': doc.title
        })
        
    except Exception as e:
        logger.error(f"Error renombrando documento {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error renombrando documento'}), 500

@document_bp.route('/api/document/<int:doc_id>/move', methods=['PUT'])
@login_required
@limiter.limit("20/minute")
def move_document(doc_id):
    """Mover documento a una carpeta o a la raíz"""
    try:
        data = request.get_json()
        
        if not data or 'folder_id' not in data:
            return jsonify({'error': 'Se requiere folder_id'}), 400
            
        new_folder_id = data.get('folder_id')
        
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
            
        # Verify the new folder belongs to user if it's not None
        if new_folder_id is not None:
            from models.models import Folder
            folder = Folder.query.filter_by(id=new_folder_id, user_id=current_user.id).first()
            if not folder:
                return jsonify({'error': 'Carpeta destino no encontrada o no autorizada'}), 404
        
        old_folder_id = doc.folder_id
        if old_folder_id == new_folder_id:
            return jsonify({'error': 'El documento ya está en esta ubicación'}), 400
            
        doc.folder_id = new_folder_id
        doc.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        folder_msg = f"carpeta {new_folder_id}" if new_folder_id else "directorio raíz"
        DocumentActivity.log_activity(
            doc_id, current_user.email, 'moved', 
            f'Documento movido a {folder_msg}', request
        )
        
        return jsonify({
            'status': 'success',
            'message': 'Documento movido correctamente',
            'id': doc.id,
            'folder_id': doc.folder_id
        })
        
    except Exception as e:
        logger.error(f"Error moviendo documento {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error moviendo documento'}), 500

@document_bp.route('/api/document/<int:doc_id>/delete', methods=['DELETE'])
@login_required
@limiter.limit("100/minute")
def delete_document(doc_id):
    """Borrado suave de documento"""
    try:
        doc = Document.query.get(doc_id)
        
        if not doc:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Verify ownership
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        if doc.is_deleted:
            return jsonify({
                'status': 'already_deleted',
                'message': 'Documento ya está en la papelera'
            }), 200
        
        # Realizar borrado suave
        doc.soft_delete()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, current_user.email, 'deleted', 
            f'Documento "{doc.title}" eliminado', request
        )
        
        logger.info(f"Documento {doc_id} eliminado por {current_user.email}")
        
        return jsonify({
            'status': 'deleted',
            'message': 'Documento eliminado correctamente',
            'deleted_at': doc.deleted_at.isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error eliminando documento {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error eliminando documento'}), 500


@document_bp.route('/api/trash', methods=['GET'])
@login_required
@limiter.limit("1/minute")
def list_trash():
    """Listar documentos eliminados (en papelera) — scoped to current_user"""
    try:
        # ALWAYS filter by authenticated user
        query = Document.query.filter(
            Document.owner_id == current_user.id,
            Document.is_deleted == True
        ).order_by(Document.deleted_at.desc())
        
        documents = query.all()
        
        trash_docs = []
        for doc in documents:
            trash_docs.append({
                'id': doc.id,
                'title': doc.title or 'Untitled',
                'deleted_at': doc.deleted_at.isoformat() if doc.deleted_at else None,
                'size_bytes': doc.size_bytes or 0,
                'document_type': doc.document_type or 'created'
            })
        
        return jsonify({
            'documents': trash_docs,
            'total': len(trash_docs)
        })
        
    except Exception as e:
        logger.error(f"Error listando trash: {e}")
        return jsonify({'error': 'Error cargando papelera'}), 500


@document_bp.route('/api/document/<int:doc_id>/restore', methods=['POST'])
@login_required
@limiter.limit("60/minute")
def restore_document(doc_id):
    """Restaurar documento eliminado o archivado"""
    try:
        doc = Document.query.get(doc_id)
        
        if not doc:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Verify ownership
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        if not doc.is_deleted and not doc.is_archived:
            return jsonify({'error': 'Documento no está en papelera ni archivado'}), 400
        
        # Restaurar documento
        doc.restore()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        # Registrar actividad
        DocumentActivity.log_activity(
            doc_id, current_user.email, 'restored', 
            f'Documento "{doc.title}" restaurado', request
        )
        
        logger.info(f"Documento {doc_id} restaurado por {current_user.email}")
        
        return jsonify({
            'status': 'restored',
            'message': 'Documento restaurado correctamente'
        })
        
    except Exception as e:
        logger.error(f"Error restaurando documento {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error restaurando documento'}), 500


@document_bp.route('/api/document/<int:doc_id>/archive', methods=['PUT'])
@login_required
@limiter.limit("20/minute")
def archive_document(doc_id):
    """Archivar/Desarchivar documento"""
    try:
        doc = Document.query.get_or_404(doc_id)
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        doc.is_archived = not doc.is_archived
        # Si se archiva, asegurar que no esté en papelera (o viceversa si se prefiere)
        if doc.is_archived:
            doc.is_deleted = False
            doc.deleted_at = None
            
        db.session.commit()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        action = 'archived' if doc.is_archived else 'unarchived'
        DocumentActivity.log_activity(
            doc_id, current_user.email, action, 
            f'Documento {action}', request
        )
        
        return jsonify({
            'status': 'success',
            'is_archived': doc.is_archived,
            'message': f'Document {action} successfully'
        })
    except Exception as e:
        logger.error(f"Error archiving document {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error archiving document'}), 500


@document_bp.route('/api/document/<int:doc_id>/delete-permanent', methods=['DELETE'])
@login_required
@limiter.limit("50/minute")
def delete_permanent(doc_id):
    """Eliminar documento permanentemente"""
    try:
        doc = Document.query.get(doc_id)
        
        if not doc:
            return jsonify({'error': 'Documento no encontrado'}), 404
        
        # Verify ownership
        if doc.owner_id != current_user.id:
            return jsonify({'error': 'No autorizado'}), 403
        
        title = doc.title
        
        # Registrar actividad ANTES de eliminar (si es posible, en caso contrario ignorar)
        try:
            DocumentActivity.log_activity(
                doc_id, current_user.email, 'deleted_permanent', 
                f'Documento "{title}" eliminado permanentemente', request
            )
        except Exception as activity_error:
            logger.warning(f"Could not log activity for permanent delete: {activity_error}")
        
        # Eliminar actividades relacionadas primero (para evitar foreign key error)
        DocumentActivity.query.filter_by(document_id=doc_id).delete()
        
        # Eliminar versiones del documento
        from models.models import DocumentVersion
        DocumentVersion.query.filter_by(document_id=doc_id).delete()
        
        # Eliminar permanentemente de la base de datos
        db.session.delete(doc)
        db.session.commit()
        
        # Invalidar cache
        invalidate_document_cache(doc_id)
        
        logger.info(f"Documento {doc_id} eliminado permanentemente por {current_user.email}")
        
        return jsonify({
            'status': 'deleted_permanent',
            'message': 'Documento eliminado permanentemente'
        })
        
    except Exception as e:
        logger.error(f"Error eliminando permanentemente documento {doc_id}: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error eliminando documento'}), 500


@document_bp.route('/api/document/delete-bulk', methods=['POST'])
@login_required
@limiter.limit("20/minute")
def delete_bulk():
    """Eliminar múltiples documentos permanentemente"""
    from models.models import DocumentVersion
    try:
        data = request.get_json()
        
        if not data or 'doc_ids' not in data:
            return jsonify({'error': 'No se proporcionaron IDs de documentos'}), 400
        
        doc_ids = data['doc_ids']
        if not isinstance(doc_ids, list):
            return jsonify({'error': 'Formato de IDs no válido'}), 400
            
        deleted_count = 0
        errors = []
        
        for doc_id in doc_ids:
            try:
                doc = Document.query.get(doc_id)
                if not doc:
                    continue
                # Skip docs not owned by current user
                if doc.owner_id != current_user.id:
                    errors.append(f"Doc {doc_id}: No autorizado")
                    continue
                
                title = doc.title
                
                # Registrar actividad (opcional)
                try:
                    DocumentActivity.log_activity(
                        doc_id, current_user.email, 'deleted_permanent_bulk', 
                        f'Documento "{title}" eliminado permanentemente (batch)', request
                    )
                except:
                    pass
                
                # Eliminar actividades relacionadas
                DocumentActivity.query.filter_by(document_id=doc_id).delete()
                
                # Eliminar versiones
                DocumentVersion.query.filter_by(document_id=doc_id).delete()
                
                # Eliminar documento
                db.session.delete(doc)
                deleted_count += 1
                
                # Invalidar cache
                invalidate_document_cache(doc_id)
                
            except Exception as item_error:
                logger.error(f"Error eliminando documento {doc_id} en batch: {item_error}")
                errors.append(f"Doc {doc_id}: {str(item_error)}")
        
        db.session.commit()
        
        return jsonify({
            'status': 'success',
            'message': f'{deleted_count} documentos eliminados permanentemente',
            'deleted_count': deleted_count,
            'errors': errors
        })
        
    except Exception as e:
        logger.error(f"Error en delete_bulk: {e}")
        db.session.rollback()
        return jsonify({'error': 'Error procesando eliminación masiva'}), 500

@document_bp.route('/api/document/<int:doc_id>/access_token', methods=['GET'])
@login_required
def get_document_access_token(doc_id):
    from flask import current_app
    from itsdangerous.url_safe import URLSafeTimedSerializer
    
    document = Document.query.get_or_404(doc_id)
    if document.owner_id != current_user.id:
        return jsonify({'error': 'No autorizado'}), 403
        
    signer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    token = signer.dumps({'document_id': document.id})
    return jsonify({'token': token})

@document_bp.route('/documentedit/<token>')
@login_required
def documentedit(token):
    """Render the document edit view for a document created by the owner"""
    from flask import current_app, render_template
    from models.models import Document, EssaySubmissionMetrics
    from itsdangerous.url_safe import URLSafeTimedSerializer
    
    signer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    try:
        data = signer.loads(token, max_age=86400)
        doc_id = data.get('document_id')
    except Exception:
        return "Token inválido o expirado", 403
        
    document = Document.query.get_or_404(doc_id)
    
    # Must be owner to access this specific screen
    if document.owner_id != current_user.id:
        return "No autorizado", 403

    metrics = EssaySubmissionMetrics.query.filter_by(document_id=document.id).first()
    
    metrics_data = {}
    if metrics:
        effective_sec = metrics.effective_time_seconds or 0
        focus_sec = (metrics.session_metadata or {}).get('total_focus_seconds', 0)
        
        metrics_data = {
            'total_words': document.size_bytes // 5,
            'writing_time': f"{effective_sec // 3600}h {(effective_sec % 3600) // 60}m {effective_sec % 60}s" if effective_sec > 3600 else f"{effective_sec // 60}m {effective_sec % 60}s",
            'focus_time': f"{focus_sec // 3600}h {(focus_sec % 3600) // 60}m {focus_sec % 60}s" if focus_sec > 3600 else f"{focus_sec // 60}m {focus_sec % 60}s",
            'keystrokes': metrics.keystrokes or 0,
            'backspaces': metrics.backspaces or 0,
            'wpm': round(metrics.wpm or 0, 1),
            'long_pauses': metrics.long_pauses or 0,
            'paste_events': (metrics.session_metadata or {}).get('paste_count', 0),
            'large_deletions': (metrics.session_metadata or {}).get('large_deletions', 0),
            'longest_burst': (metrics.session_metadata or {}).get('longest_burst', 0),
            'raw_logs': metrics.raw_logs if metrics else [],
            'activity_by_minute': (metrics.session_metadata or {}).get('activity_by_minute', {})
        }

    # Extract real content (handling JSON and Minio)
    content_delta_raw = None
    content_html_raw = None
    import json
    if getattr(document, 'storage_type', 'database') == 'minio' and document.minio_path:
        try:
            from settings.utils import load_from_minio_compressed
            delta, html = load_from_minio_compressed(document.minio_path)
            content_delta_raw = delta
            content_html_raw = html
        except Exception as e:
            logger.error(f"Error loading minio compressed file for document {document.id}: {e}")
    else:
        if document.content_delta:
            try:
                content_delta_raw = json.loads(document.content_delta)
            except Exception:
                content_delta_raw = document.content_delta
        content_html_raw = document.content_html

    return render_template('documentedit.html', 
                         document=document,
                         content_delta_raw=content_delta_raw,
                         content_html_raw=content_html_raw,
                         metrics=metrics_data,
                         now=datetime.now())

@document_bp.route('/documentview/<token>')
@login_required
def documentview(token):
    """Render the document view for a PDF document"""
    from flask import current_app, render_template
    from models.models import Document, EssaySubmissionMetrics
    from itsdangerous.url_safe import URLSafeTimedSerializer
    
    signer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
    try:
        data = signer.loads(token, max_age=86400)
        doc_id = data.get('document_id')
    except Exception:
        return "Token inválido o expirado", 403
        
    document = Document.query.get_or_404(doc_id)
    
    if document.owner_id != current_user.id:
        return "No autorizado", 403

    metrics = EssaySubmissionMetrics.query.filter_by(document_id=document.id).first()
    
    metrics_data = {}
    if metrics:
        effective_sec = metrics.effective_time_seconds or 0
        focus_sec = (metrics.session_metadata or {}).get('total_focus_seconds', 0)
        
        metrics_data = {
            'total_words': document.size_bytes // 5,
            'writing_time': f"{effective_sec // 3600}h {(effective_sec % 3600) // 60}m {effective_sec % 60}s" if effective_sec > 3600 else f"{effective_sec // 60}m {effective_sec % 60}s",
            'focus_time': f"{focus_sec // 3600}h {(focus_sec % 3600) // 60}m {focus_sec % 60}s" if focus_sec > 3600 else f"{focus_sec // 60}m {focus_sec % 60}s",
            'keystrokes': metrics.keystrokes or 0,
            'backspaces': metrics.backspaces or 0,
            'wpm': round(metrics.wpm or 0, 1),
            'long_pauses': metrics.long_pauses or 0,
            'paste_events': (metrics.session_metadata or {}).get('paste_count', 0),
            'large_deletions': (metrics.session_metadata or {}).get('large_deletions', 0),
            'longest_burst': (metrics.session_metadata or {}).get('longest_burst', 0),
            'raw_logs': metrics.raw_logs if metrics else [],
            'activity_by_minute': (metrics.session_metadata or {}).get('activity_by_minute', {})
        }

    return render_template('documentview.html', 
                         document=document,
                         metrics=metrics_data,
                         now=datetime.now())