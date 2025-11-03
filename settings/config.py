import os
from datetime import timedelta

basedir = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = '21XSWcxz3zaq45EDCxsw'
    SECURITY_PASSWORD_SALT = '146585145368132386173505678016728509634'
    REMEMBER_COOKIE_SAMESITE = "strict"
    SESSION_COOKIE_SAMESITE = "strict"
    SQLALCHEMY_COMMIT_ON_OPTIONS = True
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Configuración del editor de documentos
    MAX_DB_SIZE = 50000
    MAX_DOCUMENT_SIZE = 10 * 1024 * 1024  # 10MB
    AUTO_SAVE_DELAY = 2000
    KEEP_VERSIONS = 10
    
    # Configuración de cache
    CACHE_TYPE = 'redis'
    CACHE_REDIS_URL = 'redis://localhost:6379/0'
    CACHE_DEFAULT_TIMEOUT = 300
    
    # Redis para funcionalidades adicionales
    REDIS_URL = 'redis://localhost:6379/1'
    
    # Configuración de correo electrónico
    MAIL_SERVER = 'smtp.gmail.com'
    MAIL_PORT = 465
    MAIL_USE_SSL = True
    MAIL_USE_TLS = False
    MAIL_USERNAME = 'xplagiax@gmail.com'
    MAIL_PASSWORD = 'akkv bxvl nmui sbws'
    MAIL_DEFAULT_SENDER = ('Editor de Documentos', 'xplagiax@gmail.com')
    
    # Configuración de subida de archivos
    UPLOAD_FOLDER = os.path.join(basedir, 'uploads')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB
    ALLOWED_EXTENSIONS = {'doc', 'docx', 'pdf', 'txt', 'png', 'jpg', 'jpeg', 'gif'}
    
    # Configuración de Minio
    MINIO_ENDPOINT = 'localhost:9500'
    MINIO_ACCESS_KEY = 'minioadmin'
    MINIO_SECRET_KEY = 'minioadmin'
    MINIO_SECURE = False
    
    # Configuración de compartir documentos
    SHARE_LINK_EXPIRY_HOURS = 24 * 7  # 7 días
    
    @staticmethod
    def init_app(app):
        # Crear directorio de uploads si no existe
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

class DevelopmentConfig(Config):
    DEBUG = True
    SECRET_KEY = '43RFCvfr5edc67TGBvfr'
    SQLALCHEMY_DATABASE_URI = 'mysql+pymysql://root:@localhost/xplagiax_db'
    
class TestingConfig(Config):
    TESTING = True
    PRESERVE_CONTEXT_ON_EXCEPTION = False
    SQLALCHEMY_COMMIT_ON_TEADOWN = False
    SECRET_KEY = '65YHNbgt7ujm89UJMmko'
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'

class ProductionConfig(Config):
    DEBUG = False
    TESTING = False
    SECRET_KEY = '87UJMnhy9ikl01IOPlok'
    SQLALCHEMY_DATABASE_URI = 'mysql+pymysql://user:password@host/document_editor_db'
    
    # Configuración de producción para Minio
    MINIO_ENDPOINT = 'your-minio-server.com:9000'
    MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY')
    MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY')
    MINIO_SECURE = True

Config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}