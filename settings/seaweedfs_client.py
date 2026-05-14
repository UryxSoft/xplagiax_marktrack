# seaweedfs_client.py
"""
Cliente SeaweedFS para xplagiax_marktrack.
Reemplaza MinIO con SeaweedFS usando su API REST nativa.
"""
import requests
import os
import io
import uuid
import gzip
import json
from datetime import datetime, timedelta
from io import BytesIO
from urllib.parse import quote
from flask import send_file
import logging

logger = logging.getLogger(__name__)


class SeaweedFSClient:
    """
    Cliente para SeaweedFS usando su API REST nativa.
    Compatible con la interfaz anterior de MinioClient para facilitar migración.
    """
    
    def __init__(self, filer_url, master_url=None, secure=False):
        """
        Args:
            filer_url: URL del SeaweedFS Filer (ej: http://localhost:8888)
            master_url: URL del SeaweedFS Master (ej: http://localhost:9333) - opcional
            secure: Si usar HTTPS (no usado en SeaweedFS Filer directo)
        """
        protocol = "https" if secure else "http"
        # Verificar si ya tiene protocolo
        if filer_url.startswith("http://") or filer_url.startswith("https://"):
            self.filer_url = filer_url.rstrip('/')
        else:
            self.filer_url = f"{protocol}://{filer_url}".rstrip('/')
            
        self.master_url = master_url.rstrip('/') if master_url else None
        
        # Buckets como directorios
        self._buckets = {}
    
    def bucket_exists(self, bucket_name):
        """Verificar si un bucket (directorio) existe"""
        try:
            response = requests.head(f"{self.filer_url}/{bucket_name}/", timeout=5)
            return response.status_code in [200, 204]
        except Exception as e:
            logger.warning(f"Error verificando bucket {bucket_name}: {e}")
            return False
    
    def make_bucket(self, bucket_name):
        """Crear un bucket (directorio) en SeaweedFS"""
        try:
            # SeaweedFS crea directorios automáticamente al subir archivos
            # Pero podemos crear explícitamente con PUT vacío
            response = requests.put(
                f"{self.filer_url}/{bucket_name}/.keep",
                data=b'',
                headers={'Content-Type': 'application/octet-stream'},
                timeout=10
            )
            if response.status_code in [200, 201, 204]:
                logger.info(f"Bucket '{bucket_name}' creado exitosamente")
                return True
            else:
                logger.warning(f"Error creando bucket: {response.status_code}")
                return False
        except Exception as e:
            logger.error(f"Error creando bucket {bucket_name}: {e}")
            return False
    
    def put_object(self, bucket_name, object_name, data, length=None, content_type='application/octet-stream', metadata=None):
        """
        Subir un objeto a SeaweedFS.
        
        Args:
            bucket_name: Nombre del bucket/directorio
            object_name: Nombre/ruta del objeto
            data: Datos del archivo (BytesIO o bytes)
            length: Longitud de los datos (opcional)
            content_type: Tipo MIME del contenido
            metadata: Diccionario de metadata adicional
        
        Returns:
            Objeto con información del resultado
        """
        try:
            full_path = f"/{bucket_name}/{object_name}"
            
            # Preparar headers
            headers = {'Content-Type': content_type}
            
            # Agregar metadata como headers X-*
            if metadata:
                for key, value in metadata.items():
                    safe_key = key.replace('_', '-').title()
                    headers[f'X-{safe_key}'] = str(value)
            
            # Leer datos si es BytesIO
            if hasattr(data, 'read'):
                file_data = data.read()
            else:
                file_data = data
            
            response = requests.put(
                f"{self.filer_url}{full_path}",
                data=file_data,
                headers=headers,
                timeout=60
            )
            
            if response.status_code not in [200, 201]:
                raise Exception(f"Error subiendo objeto: {response.status_code} - {response.text}")
            
            # Retornar objeto compatible con MinIO
            return SeaweedFSPutResult(
                bucket_name=bucket_name,
                object_name=object_name,
                etag=response.headers.get('ETag', ''),
                version_id=None
            )
            
        except Exception as e:
            logger.error(f"Error en put_object: {e}")
            raise
    
    def get_object(self, bucket_name, object_name):
        """
        Descargar un objeto de SeaweedFS.
        
        Returns:
            Objeto similar a response de MinIO con método read()
        """
        try:
            full_path = f"/{bucket_name}/{object_name}"
            response = requests.get(
                f"{self.filer_url}{full_path}",
                timeout=60
            )
            
            if response.status_code == 404:
                raise Exception(f"Objeto no encontrado: {object_name}")
            elif response.status_code != 200:
                raise Exception(f"Error descargando objeto: {response.text}")
            
            # Retornar wrapper compatible con MinIO
            return SeaweedFSGetResult(response.content, response.headers)
            
        except Exception as e:
            logger.error(f"Error en get_object: {e}")
            raise
    
    def remove_object(self, bucket_name, object_name):
        """Eliminar un objeto de SeaweedFS"""
        try:
            full_path = f"/{bucket_name}/{object_name}"
            response = requests.delete(
                f"{self.filer_url}{full_path}",
                timeout=30
            )
            
            if response.status_code not in [200, 204, 404]:
                raise Exception(f"Error eliminando objeto: {response.text}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error en remove_object: {e}")
            raise
    
    def stat_object(self, bucket_name, object_name):
        """Obtener metadata de un objeto"""
        try:
            full_path = f"/{bucket_name}/{object_name}"
            response = requests.head(
                f"{self.filer_url}{full_path}",
                timeout=10
            )
            
            if response.status_code == 404:
                raise Exception(f"Objeto no encontrado: {object_name}")
            
            return SeaweedFSStatResult(
                bucket_name=bucket_name,
                object_name=object_name,
                size=int(response.headers.get('Content-Length', 0)),
                content_type=response.headers.get('Content-Type', ''),
                last_modified=response.headers.get('Last-Modified', ''),
                etag=response.headers.get('ETag', '')
            )
            
        except Exception as e:
            logger.error(f"Error en stat_object: {e}")
            raise
    
    def presigned_get_object(self, bucket_name, object_name, expires=timedelta(hours=1)):
        """
        Generar URL pública para un objeto.
        En SeaweedFS, las URLs son directas (sin firma necesaria por defecto).
        
        Args:
            bucket_name: Nombre del bucket
            object_name: Nombre del objeto
            expires: No usado en SeaweedFS (mantenido para compatibilidad)
        
        Returns:
            URL directa al archivo
        """
        encoded_path = quote(f"/{bucket_name}/{object_name}")
        return f"{self.filer_url}{encoded_path}"
    
    def list_objects(self, bucket_name, prefix='', recursive=True):
        """Listar objetos en un bucket"""
        try:
            full_path = f"/{bucket_name}/{prefix}"
            response = requests.get(
                f"{self.filer_url}{full_path}",
                params={'limit': 1000},
                timeout=30
            )
            
            if response.status_code == 404:
                return []
            
            # Intentar parsear como JSON (Filer API)
            try:
                data = response.json()
                entries = data.get('Entries', [])
                
                objects = []
                for entry in entries:
                    if not entry.get('IsDirectory', False) or recursive:
                        objects.append(SeaweedFSObject(
                            object_name=entry.get('FullPath', '').replace(f"/{bucket_name}/", ''),
                            size=entry.get('FileSize', 0),
                            is_dir=entry.get('IsDirectory', False),
                            last_modified=entry.get('Mtime', '')
                        ))
                return objects
                
            except json.JSONDecodeError:
                return []
            
        except Exception as e:
            logger.error(f"Error en list_objects: {e}")
            return []


class SeaweedFSPutResult:
    """Resultado de put_object compatible con MinIO"""
    def __init__(self, bucket_name, object_name, etag, version_id=None):
        self.bucket_name = bucket_name
        self.object_name = object_name
        self.etag = etag
        self.version_id = version_id


class SeaweedFSGetResult:
    """Resultado de get_object compatible con MinIO"""
    def __init__(self, content, headers):
        self._content = content
        self._headers = headers
        self._position = 0
    
    def read(self, size=None):
        if size is None:
            return self._content
        result = self._content[self._position:self._position + size]
        self._position += size
        return result
    
    def close(self):
        pass
    
    def release_conn(self):
        pass


class SeaweedFSStatResult:
    """Resultado de stat_object compatible con MinIO"""
    def __init__(self, bucket_name, object_name, size, content_type, last_modified, etag):
        self.bucket_name = bucket_name
        self.object_name = object_name
        self.size = size
        self.content_type = content_type
        self.last_modified = last_modified
        self.etag = etag


class SeaweedFSObject:
    """Objeto en lista compatible con MinIO"""
    def __init__(self, object_name, size, is_dir, last_modified):
        self.object_name = object_name
        self.size = size
        self.is_dir = is_dir
        self.last_modified = last_modified
