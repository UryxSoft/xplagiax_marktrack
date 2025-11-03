from settings.extensions import db
from datetime import datetime, timedelta
import uuid
import json

class User(db.Model):
    """Modelo de usuario para el sistema de compartir"""
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    isactive = db.Column(db.Boolean, default=True)
    
    # Relaciones
    owned_documents = db.relationship('Document', backref='owner', lazy='dynamic')
    shared_documents = db.relationship('DocumentShare', backref='user', lazy='dynamic')
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'created_at': self.created_at.isoformat(),
            'isactive': self.isactive
        }
    
    @staticmethod
    def get_or_create(email, name=None):
        """Obtener o crear usuario por email"""
        user = User.query.filter_by(email=email).first()
        if not user:
            user = User(email=email, name=name)
            db.session.add(user)
            db.session.commit()
        return user

class Document(db.Model):
    """Modelo principal de documento"""
    __tablename__ = 'marktrack_documents'
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False, default='Sin título')
    content_delta = db.Column(db.Text, nullable=True)
    content_html = db.Column(db.Text, nullable=True)
    minio_path = db.Column(db.String(255), nullable=True)
    storage_type = db.Column(db.String(20), default='database')
    size_bytes = db.Column(db.Integer, default=0)
    
    # Metadata del documento
    document_type = db.Column(db.String(50), default='created')  # created, uploaded
    original_filename = db.Column(db.String(255), nullable=True)
    mime_type = db.Column(db.String(100), nullable=True)
    
    # Propietario
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    # Control de versiones
    version_number = db.Column(db.Integer, default=1)
    is_deleted = db.Column(db.Boolean, default=False)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)
    
    # Relaciones
    versions = db.relationship('DocumentVersion', backref='document', cascade='all, delete-orphan')
    shares = db.relationship('DocumentShare', backref='document', cascade='all, delete-orphan')
    
    def to_dict(self, include_content=False):
        data = {
            'id': self.id,
            'title': self.title,
            'storage_type': self.storage_type,
            'size_bytes': self.size_bytes,
            'document_type': self.document_type,
            'original_filename': self.original_filename,
            'mime_type': self.mime_type,
            'version_number': self.version_number,
            'is_deleted': self.is_deleted,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'owner_id': self.owner_id,
            'owner_email': self.owner.email if self.owner else None
        }
        
        if include_content:
            if self.storage_type == 'database':
                data['delta'] = json.loads(self.content_delta) if self.content_delta else {}
                data['html'] = self.content_html or ''
            else:
                # El contenido se cargará desde Minio según sea necesario
                data['delta'] = {}
                data['html'] = ''
        
        return data
    
    def soft_delete(self):
        """Borrado suave del documento"""
        self.is_deleted = True
        self.deleted_at = datetime.utcnow()
        db.session.commit()
    
    def restore(self):
        """Restaurar documento borrado"""
        self.is_deleted = False
        self.deleted_at = None
        db.session.commit()

class DocumentVersion(db.Model):
    """Modelo para versiones de documento"""
    __tablename__ = 'marktrack_document_versions'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)
    
    # Contenido de la versión
    content_delta = db.Column(db.Text)
    content_html = db.Column(db.Text)
    minio_path = db.Column(db.String(255), nullable=True)
    size_bytes = db.Column(db.Integer, default=0)
    
    # Metadatos
    change_summary = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.String(100), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'document_id': self.document_id,
            'version_number': self.version_number,
            'size_bytes': self.size_bytes,
            'change_summary': self.change_summary,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat()
        }

class DocumentShare(db.Model):
    """Modelo para compartir documentos"""
    __tablename__ = 'marktrack_document_shares'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Permisos
    permission_level = db.Column(db.String(20), default='read')  # read, write, admin
    
    # Token para acceso directo
    share_token = db.Column(db.String(100), unique=True, nullable=False)
    
    # Control de acceso
    is_active = db.Column(db.Boolean, default=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    access_count = db.Column(db.Integer, default=0)
    last_accessed_at = db.Column(db.DateTime, nullable=True)
    
    # Metadatos
    shared_by_email = db.Column(db.String(255), nullable=False)
    share_message = db.Column(db.Text, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __init__(self, **kwargs):
        super(DocumentShare, self).__init__(**kwargs)
        if not self.share_token:
            self.share_token = str(uuid.uuid4())
        if not self.expires_at:
            self.expires_at = datetime.utcnow() + timedelta(days=7)
    
    def to_dict(self):
        return {
            'id': self.id,
            'document_id': self.document_id,
            'user_id': self.user_id,
            'user_email': self.user.email,
            'permission_level': self.permission_level,
            'share_token': self.share_token,
            'is_active': self.is_active,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'access_count': self.access_count,
            'last_accessed_at': self.last_accessed_at.isoformat() if self.last_accessed_at else None,
            'shared_by_email': self.shared_by_email,
            'share_message': self.share_message,
            'created_at': self.created_at.isoformat(),
            'document_title': self.document.title if self.document else None
        }
    
    @property
    def is_expired(self):
        """Verificar si el enlace ha expirado"""
        if self.expires_at:
            return datetime.utcnow() > self.expires_at
        return False
    
    def record_access(self):
        """Registrar un acceso al documento compartido"""
        self.access_count += 1
        self.last_accessed_at = datetime.utcnow()
        db.session.commit()
    
    def revoke(self):
        """Revocar acceso compartido"""
        self.is_active = False
        db.session.commit()

class DocumentActivity(db.Model):
    """Modelo para registrar actividad en documentos"""
    __tablename__ = 'marktrack_document_activities'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    user_email = db.Column(db.String(255), nullable=False)
    
    # Tipo de actividad
    activity_type = db.Column(db.String(50), nullable=False)  # created, updated, shared, viewed, deleted
    description = db.Column(db.Text, nullable=True)
    
    # Metadatos
    ip_address = db.Column(db.String(45), nullable=True)
    user_agent = db.Column(db.Text, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relación
    document = db.relationship('Document', backref='activities')
    
    def to_dict(self):
        return {
            'id': self.id,
            'document_id': self.document_id,
            'user_email': self.user_email,
            'activity_type': self.activity_type,
            'description': self.description,
            'created_at': self.created_at.isoformat(),
            'document_title': self.document.title if self.document else None
        }
    
    @staticmethod
    def log_activity(document_id, user_email, activity_type, description=None, request=None):
        """Registrar actividad en un documento"""
        activity = DocumentActivity(
            document_id=document_id,
            user_email=user_email,
            activity_type=activity_type,
            description=description
        )
        
        if request:
            activity.ip_address = request.environ.get('HTTP_X_FORWARDED_FOR') or request.environ.get('REMOTE_ADDR')
            activity.user_agent = request.environ.get('HTTP_USER_AGENT')
        
        db.session.add(activity)
        db.session.commit()
        return