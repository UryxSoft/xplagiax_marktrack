from flask import Flask
from flask_mail import Mail
from settings.extensions import db, cache, limiter, minio_client, redis_client, mail
from settings.config import Config
import os
from minio.error import S3Error
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_app(config_name='development'):
    app = Flask(__name__)
    
    # Cargar configuración
    app.config.from_object(Config[config_name])
    
    # Inicializar extensiones
    db.init_app(app)
    cache.init_app(app)
    limiter.init_app(app)
    mail.init_app(app)
    
    # Crear buckets de Minio si no existen
    with app.app_context():
        create_minio_buckets()
        
        # Crear tablas
        db.create_all()
    
    # Registrar blueprints
    from routes.document_routes import document_bp
    from routes.share_routes import share_bp
    from routes.upload_routes import upload_bp
    
    app.register_blueprint(document_bp, url_prefix='/api')
    app.register_blueprint(share_bp, url_prefix='/api')
    app.register_blueprint(upload_bp, url_prefix='/api')
    
    # Ruta principal
    @app.route('/')
    def index():
        return app.send_static_file('frontend.html')
    
    return app

def create_minio_buckets():
    """Crear buckets de Minio si no existen"""
    BUCKETS = ['documents', 'images', 'exports', 'backups', 'uploads']
    for bucket in BUCKETS:
        try:
            if not minio_client.bucket_exists(bucket):
                minio_client.make_bucket(bucket)
                logger.info(f"Bucket {bucket} creado")
        except S3Error as e:
            logger.error(f"Error creando bucket {bucket}: {e}")

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='127.0.0.1', port=5002)