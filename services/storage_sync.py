import threading
import time
import os
import logging
from datetime import datetime
from io import BytesIO
from flask import current_app
from models.models import Document, DocumentVersion
from settings.extensions import db, minio_client

logger = logging.getLogger(__name__)

class StorageSyncWorker:
    """
    Worker en segundo plano que sincroniza archivos de almacenamiento local 
    hacia SeaweedFS cuando este vuelve a estar disponible.
    """
    _thread = None
    _stop_event = threading.Event()
    _app = None

    @classmethod
    def start(cls, app):
        """Iniciar el worker en un hilo separado"""
        if cls._thread is not None:
            return
            
        cls._app = app
        cls._stop_event.clear()
        cls._thread = threading.Thread(target=cls._run_loop, name="StorageSyncWorker", daemon=True)
        cls._thread.start()
        logger.info("StorageSyncWorker iniciado en segundo plano")

    @classmethod
    def stop(cls):
        """Detener el worker"""
        cls._stop_event.set()
        if cls._thread:
            cls._thread.join(timeout=5)
            cls._thread = None

    @classmethod
    def _run_loop(cls):
        """Bucle principal del worker"""
        # Esperar un poco al inicio para que la app termine de cargar
        time.sleep(10)
        
        while not cls._stop_event.is_set():
            try:
                with cls._app.app_context():
                    cls._perform_sync()
            except Exception as e:
                logger.error(f"Error en bucle de StorageSyncWorker: {e}")
            
            # Esperar 60 segundos antes de la siguiente revisión
            time.sleep(60)

    @classmethod
    def _perform_sync(cls):
        """Lógica de sincronización"""
        # 1. Verificar si SeaweedFS está disponible
        if not minio_client.bucket_exists('documents'):
            return

        logger.info("SeaweedFS disponible, iniciando sincronización de archivos locales...")
        
        # 2. Sincronizar Documentos
        cls._sync_documents()
        
        # 3. Sincronizar Versiones
        cls._sync_versions()
        
        # 4. Sincronizar Imágenes (escaneo de directorio)
        cls._sync_images()

    @classmethod
    def _sync_documents(cls):
        """Sincronizar documentos con prefijo local://"""
        docs = Document.query.filter(Document.minio_path.like('local://%')).all()
        if not docs:
            return
            
        logger.info(f"Sincronizando {len(docs)} documentos hacia SeaweedFS...")
        
        upload_folder = cls._app.config.get('UPLOAD_FOLDER', 'uploads')
        docs_dir = os.path.join(upload_folder, 'documents')
        
        for doc in docs:
            try:
                filename = doc.minio_path.replace('local://', '')
                local_path = os.path.join(docs_dir, filename)
                
                if not os.path.exists(local_path):
                    logger.warning(f"Archivo local no encontrado para documento {doc.id}: {local_path}")
                    # Limpiar path si el archivo no existe
                    doc.minio_path = None
                    db.session.commit()
                    continue
                
                # Leer y subir a SeaweedFS
                with open(local_path, 'rb') as f:
                    data = f.read()
                
                minio_client.put_object(
                    bucket_name='documents',
                    object_name=filename,
                    data=BytesIO(data),
                    length=len(data),
                    content_type='application/gzip'
                )
                
                # Actualizar base de datos
                doc.minio_path = filename
                db.session.commit()
                
                # Eliminar local
                os.remove(local_path)
                logger.info(f"Documento {doc.id} sincronizado y eliminado de local: {filename}")
                
            except Exception as e:
                logger.error(f"Error sincronizando documento {doc.id}: {e}")

    @classmethod
    def _sync_versions(cls):
        """Sincronizar versiones con prefijo local://"""
        versions = DocumentVersion.query.filter(DocumentVersion.minio_path.like('local://%')).all()
        if not versions:
            return
            
        logger.info(f"Sincronizando {len(versions)} versiones hacia SeaweedFS...")
        
        upload_folder = cls._app.config.get('UPLOAD_FOLDER', 'uploads')
        docs_dir = os.path.join(upload_folder, 'documents')
        
        for ver in versions:
            try:
                filename = ver.minio_path.replace('local://', '')
                local_path = os.path.join(docs_dir, filename)
                
                if not os.path.exists(local_path):
                    ver.minio_path = None
                    db.session.commit()
                    continue
                
                with open(local_path, 'rb') as f:
                    data = f.read()
                
                minio_client.put_object(
                    bucket_name='documents',
                    object_name=filename,
                    data=BytesIO(data),
                    length=len(data),
                    content_type='application/gzip'
                )
                
                ver.minio_path = filename
                db.session.commit()
                os.remove(local_path)
                logger.info(f"Versión {ver.id} sincronizada y eliminada de local: {filename}")
                
            except Exception as e:
                logger.error(f"Error sincronizando versión {ver.id}: {e}")

    @classmethod
    def _sync_images(cls):
        """Escanear directorio de imágenes y subir a SeaweedFS"""
        upload_folder = cls._app.config.get('UPLOAD_FOLDER', 'uploads')
        images_dir = os.path.join(upload_folder, 'images')
        
        if not os.path.exists(images_dir):
            return
            
        files = [f for f in os.listdir(images_dir) if os.path.isfile(os.path.join(images_dir, f)) and f != '.keep']
        if not files:
            return
            
        logger.info(f"Sincronizando {len(files)} imágenes hacia SeaweedFS...")
        
        for filename in files:
            try:
                local_path = os.path.join(images_dir, filename)
                
                # Determinar tipo de contenido
                content_type = 'image/png'
                if filename.lower().endswith(('.jpg', '.jpeg')):
                    content_type = 'image/jpeg'
                elif filename.lower().endswith('.gif'):
                    content_type = 'image/gif'
                elif filename.lower().endswith('.webp'):
                    content_type = 'image/webp'
                
                with open(local_path, 'rb') as f:
                    data = f.read()
                
                minio_client.put_object(
                    bucket_name='images',
                    object_name=filename,
                    data=BytesIO(data),
                    length=len(data),
                    content_type=content_type
                )
                
                # Eliminar local (con éxito en SeaweedFS)
                os.remove(local_path)
                logger.info(f"Imagen sincronizada y eliminada de local: {filename}")
                
            except Exception as e:
                logger.error(f"Error sincronizando imagen {filename}: {e}")
