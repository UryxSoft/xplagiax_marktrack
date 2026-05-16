from settings.extensions import db
from flask_login import UserMixin
from datetime import datetime, timedelta
from sqlalchemy import Index, Enum
import uuid
import json
import secrets
import enum

# Para tokens JWT
try:
    from itsdangerous import URLSafeTimedSerializer as Serializer
except ImportError:
    from itsdangerous.url_safe import URLSafeTimedSerializer as Serializer

# Importar config para SECRET_KEY
from settings.config import Config


# ============================================================================
# MODELOS DE SOPORTE
# ============================================================================

class StoragePlan(db.Model):
    """Planes de almacenamiento disponibles"""
    __tablename__ = 'storage_plans'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    base_storage_mb = db.Column(db.Integer, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    trial_days = db.Column(db.Integer, default=0)
    price_monthly_usd = db.Column(db.Float, default=0)
    price_annual_usd = db.Column(db.Float, default=0)
    stripe_price_monthly = db.Column(db.String(100), nullable=True)
    stripe_price_annual = db.Column(db.String(100), nullable=True)
    paypal_plan_monthly = db.Column(db.String(100), nullable=True)
    paypal_plan_annual = db.Column(db.String(100), nullable=True)
    
    users = db.relationship('User', backref='storage_plan', lazy='dynamic')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'base_storage_mb': self.base_storage_mb,
            'description': self.description,
            'price_monthly_usd': self.price_monthly_usd,
            'price_annual_usd': self.price_annual_usd,
            'trial_days': self.trial_days,
            'paypal_plan_monthly': self.paypal_plan_monthly,
            'paypal_plan_annual': self.paypal_plan_annual,
            'is_active': self.is_active
        }
    
    @staticmethod
    def create_default_plans():
        """Crear planes por defecto si no existen"""
        default_plans = [
            {'name': 'Starter', 'base_storage_mb': 100, 'price_monthly_usd': 0, 'price_annual_usd': 0},
            {'name': 'Individual', 'base_storage_mb': 500, 'price_monthly_usd': 5, 'price_annual_usd': 48},
            {'name': 'Scholar Suite', 'base_storage_mb': 1000, 'price_monthly_usd': 10, 'price_annual_usd': 96},
            {'name': 'Research Essentials', 'base_storage_mb': 2000, 'price_monthly_usd': 20, 'price_annual_usd': 192},
            {'name': 'Institutes', 'base_storage_mb': 5000, 'price_monthly_usd': 50, 'price_annual_usd': 480},
        ]
        
        for plan_data in default_plans:
            if not StoragePlan.query.filter_by(name=plan_data['name']).first():
                plan = StoragePlan(**plan_data)
                db.session.add(plan)
        
        db.session.commit()


class UserAddonSubscription(db.Model):
    """Suscripciones adicionales de almacenamiento"""
    __tablename__ = 'user_addon_subscriptions'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    addon_id = db.Column(db.Integer, db.ForeignKey('storage_addons.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # expires_at = db.Column(db.DateTime, nullable=True)
    
    addon = db.relationship('StorageAddon', backref='subscriptions')


class StorageAddon(db.Model):
    """Addons de almacenamiento adicional"""
    __tablename__ = 'storage_addons'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    storage_mb = db.Column(db.Integer, default=1000)
    price_monthly = db.Column(db.Float, default=2)
    is_active = db.Column(db.Boolean, default=True)


class AnalysisLimit(db.Model):
    """Límites de análisis por plan"""
    __tablename__ = 'analysis_limits'
    
    id = db.Column(db.Integer, primary_key=True)
    plan_name = db.Column(db.String(50), nullable=False)
    daily_analysis_limit = db.Column(db.Integer, default=10)
    description = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, default=True)


class UserAnalysisUsage(db.Model):
    """Uso de análisis por usuario"""
    __tablename__ = 'user_analysis_usage'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    usage_date = db.Column(db.Date, nullable=False)
    analysis_count = db.Column(db.Integer, default=0)
    limit_reached_at = db.Column(db.DateTime, nullable=True)
    last_reset_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Folder(db.Model):
    """Carpetas de usuario"""
    __tablename__ = 'folders'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    path = db.Column(db.String(500), nullable=True)
    color = db.Column(db.String(20), default='#6d28d9')
    description = db.Column(db.String(500), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('folders.id'), nullable=True)
    is_archived = db.Column(db.Boolean, default=False)
    is_deleted = db.Column(db.Boolean, default=False)
    deleted_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    files = db.relationship('File', backref='folder', lazy='dynamic')
    children = db.relationship('Folder', backref=db.backref('parent', remote_side=[id]))

    shares = db.relationship('FolderShare', backref='folder', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color or '#6d28d9',
            'description': self.description,
            'parent_id': self.parent_id,
            'is_archived': self.is_archived,
            'is_deleted': self.is_deleted,
            'shared': [s.user.email for s in self.shares if getattr(s, 'user', None)] if hasattr(self, 'shares') else [],
            'doc_count': self.documents.filter_by(is_deleted=False).count() if hasattr(self.documents, 'count') else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = datetime.utcnow()
        db.session.commit()

    def restore(self):
        self.is_deleted = False
        self.is_archived = False
        self.deleted_at = None
        db.session.commit()



class File(db.Model):
    """Archivos de usuario"""
    __tablename__ = 'files'
    
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=True)
    mime_type = db.Column(db.String(100), nullable=True)
    size = db.Column(db.BigInteger, default=0)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    folder_id = db.Column(db.Integer, db.ForeignKey('folders.id'), nullable=True)
    minio_url = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# ============================================================================
# LOGIN / LOGOUT TRACKING
# ============================================================================

class UserAuthLog(db.Model):
    """Historial de Autenticación de Usuario (Login/Logout)"""
    __tablename__ = 'user_auth_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action = db.Column(db.String(50), nullable=False)  # 'login' or 'logout'
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    ip_address = db.Column(db.String(100), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)

# ============================================================================
# MODELO DE USUARIO PRINCIPAL
# ============================================================================

class User(db.Model, UserMixin):
    """Modelo de usuario completo con OAuth y gestión de sesión"""
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), unique=True, nullable=False)
    _password_hash = db.Column(db.String(255), nullable=True)
    hashCode = db.Column(db.String(255), nullable=True)
    name = db.Column(db.String(100), nullable=True)
    lastname = db.Column(db.String(100), nullable=True)
    avatar = db.Column(db.String(200), nullable=True)
    tokens = db.Column(db.Text, nullable=True)
    institute = db.Column(db.String(255), nullable=True)
    country = db.Column(db.String(100), nullable=True)
    isactive = db.Column(db.Boolean, default=False)
    token = db.Column(db.Text, nullable=True)
    totp_secret = db.Column(db.String(16), nullable=True)
    # theme_preference = db.Column(db.String(10), default='light')  # Legacy
    settings_json = db.Column(db.Text, nullable=True) # Centralized settings store (JSON)
    
    # Session management
    active_session = db.Column(db.Boolean, default=False)
    session_token = db.Column(db.String(128), nullable=True, unique=True)
    session_created_at = db.Column(db.DateTime, nullable=True)
    last_login = db.Column(db.DateTime, nullable=True)
    
    # Email confirmation
    confirmed = db.Column(db.Boolean, default=False)
    confirmed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    folders = db.relationship('Folder', backref='user', lazy=True)
    files = db.relationship('File', backref='owner', lazy=True)
    auth_logs = db.relationship('UserAuthLog', backref='user', lazy='dynamic')
    
    # Storage and plan
    storage_plan_id = db.Column(db.Integer, db.ForeignKey('storage_plans.id'), nullable=True)
    used_storage_bytes = db.Column(db.BigInteger, default=0)
    user_type = db.Column(db.String(50), default='Starter')
    addon_subscriptions = db.relationship('UserAddonSubscription', backref='user', lazy=True)
    
    # Trial & subscription fields
    is_on_trial = db.Column(db.Boolean, default=False)
    trial_starts_at = db.Column(db.DateTime, nullable=True)
    trial_ends_at = db.Column(db.DateTime, nullable=True)
    trial_notified = db.Column(db.Boolean, default=False)
    
    # Subscription management
    subscription_provider = db.Column(db.String(32), nullable=True)
    subscription_id = db.Column(db.String(128), nullable=True)
    subscription_status = db.Column(db.String(64), nullable=True)
    subscription_type = db.Column(db.String(32), nullable=True)
    subscription_starts_at = db.Column(db.DateTime, nullable=True)
    subscription_ends_at = db.Column(db.DateTime, nullable=True)
    subscription_renewal_notified = db.Column(db.Boolean, default=False)
    
    # OAuth fields
    oauth_provider = db.Column(db.String(32), nullable=True)
    oauth_id = db.Column(db.String(128), nullable=True)
    
    # Document relationships
    owned_documents = db.relationship('Document', backref='owner', lazy='dynamic')
    shared_documents = db.relationship('DocumentShare', back_populates='shared_with_user', lazy='dynamic')
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_users_email', 'email'),
        Index('idx_users_session_token', 'session_token'),
        Index('idx_users_subscription_id', 'subscription_id'),
        Index('idx_users_trial_ends', 'trial_ends_at'),
        Index('idx_users_oauth', 'oauth_provider', 'oauth_id'),
    )
    
    def __init__(self, email, **kwargs):
        self.email = email.lower().strip()
        self._password_hash = kwargs.get('_password_hash')
        self.hashCode = kwargs.get('hashCode')
        self.name = kwargs.get('name')
        self.lastname = kwargs.get('lastname')
        self.avatar = kwargs.get('avatar')
        self.tokens = kwargs.get('tokens')
        self.institute = kwargs.get('institute')
        self.country = kwargs.get('country')
        self.isactive = kwargs.get('isactive', False)
        self.token = kwargs.get('token')
        self.totp_secret = kwargs.get('totp_secret')
        self.active_session = kwargs.get('active_session')
        self.confirmed = kwargs.get('confirmed', False)
        self.confirmed_at = kwargs.get('confirmed_at')
        self.storage_plan_id = kwargs.get('storage_plan_id')
        self.used_storage_bytes = kwargs.get('used_storage_bytes', 0)
        self.user_type = kwargs.get('user_type', 'Starter')
        self.oauth_provider = kwargs.get('oauth_provider')
        self.oauth_id = kwargs.get('oauth_id')
        
        # Auto-confirm OAuth users
        if self.oauth_provider:
            self.confirmed = True
            self.confirmed_at = datetime.utcnow()
            self.isactive = True

    # =========================================================================
    # Flask-Login Required Methods
    # =========================================================================
    
    @property
    def is_active(self):
        """Flask-Login: Is the user active?"""
        return bool(self.isactive)
    
    @property
    def is_authenticated(self):
        """Flask-Login: Is the user authenticated?"""
        return True
    
    @property
    def is_anonymous(self):
        """Flask-Login: Is this an anonymous user?"""
        return False
    
    def get_id(self):
        """Flask-Login: Return user ID as string"""
        return str(self.id)

    # =========================================================================
    # Session Management
    # =========================================================================
    
    def create_session(self):
        """Create a new session token and invalidate any existing session"""
        self.session_token = secrets.token_urlsafe(32)
        self.active_session = True
        self.session_created_at = datetime.utcnow()
        self.last_login = datetime.utcnow()
        return self.session_token

    def invalidate_session(self):
        """Invalidate current session"""
        self.session_token = None
        self.active_session = False
        self.session_created_at = None

    def is_session_valid(self, token):
        """Check if provided token matches current session"""
        if not self.active_session or not self.session_token:
            return False
        if not self.session_created_at:
            return False
        # Session expires after 30 days
        if datetime.utcnow() - self.session_created_at > timedelta(days=30):
            return False
        return self.session_token == token

    # =========================================================================
    # Storage Management
    # =========================================================================
    
    def get_total_storage_limit_bytes(self):
        """Calculate total storage limit in bytes"""
        if not self.storage_plan:
            return 1024 * 1024 * 1024  # Default 1GB
        base_storage_bytes = self.storage_plan.base_storage_mb * 1024 * 1024
        addon_storage_bytes = sum(
            subscription.addon.storage_mb * 1024 * 1024
            for subscription in self.addon_subscriptions
            if subscription.is_active
        )
        return base_storage_bytes + addon_storage_bytes
    
    def get_remaining_storage_bytes(self):
        """Calculate remaining storage in bytes"""
        return self.get_total_storage_limit_bytes() - self.used_storage_bytes
    
    def get_storage_usage_percentage(self):
        """Calculate storage usage percentage"""
        total = self.get_total_storage_limit_bytes()
        if total == 0:
            return 100
        return (self.used_storage_bytes / total) * 100
    
    def can_upload_file(self, file_size_bytes):
        """Check if user can upload a file of given size"""
        return file_size_bytes <= self.get_remaining_storage_bytes()

    # =========================================================================
    # Token Management
    # =========================================================================
    
    def get_token(self, purpose, expires_sec=3600):
        """Generate a JWT token for a specific purpose"""
        secret_key = Config['default'].SECRET_KEY
        if not isinstance(secret_key, str):
            secret_key = str(secret_key)
        s = Serializer(secret_key)
        return s.dumps({purpose: self.id})

    @staticmethod
    def verify_token(token, purpose):
        """Verify a token and return the user if valid"""
        secret_key = Config['default'].SECRET_KEY
        if not isinstance(secret_key, str):
            secret_key = str(secret_key)
        s = Serializer(secret_key)
        try:
            data = s.loads(token, max_age=86400)  # 24 hour expiration
            user_id = data.get(purpose)
            if user_id:
                return User.query.get(user_id)
        except Exception:
            return None
        return None

    # =========================================================================
    # Subscription Management
    # =========================================================================
    
    def has_active_subscription(self):
        """Check if user has an active subscription (not trial)"""
        if self.is_on_trial:
            return False
        if self.subscription_status == 'active':
            if self.subscription_ends_at:
                return datetime.utcnow() < self.subscription_ends_at
            return True
        if self.user_type and self.user_type in ['Scholar Suite', 'Individual', 'Research Essentials', 'Institutes']:
            if self.subscription_id:
                return self.subscription_status in ['active', 'trialing']
        return False

    def is_trial_expired(self):
        """Check if trial has expired"""
        if not self.is_on_trial or not self.trial_ends_at:
            return False
        return datetime.utcnow() > self.trial_ends_at
    
    def is_trial_active(self):
        """Check if user has an active trial"""
        if not self.is_on_trial or not self.trial_ends_at:
            return False
        return datetime.utcnow() < self.trial_ends_at
    
    def start_trial(self, trial_days=14):
        """Start trial period for user"""
        if self.is_on_trial or self.has_active_subscription():
            return False
        
        now = datetime.utcnow()
        self.is_on_trial = True
        self.trial_starts_at = now
        self.trial_ends_at = now + timedelta(days=trial_days)
        self.trial_notified = False
        self.subscription_status = 'trialing'
        self.subscription_starts_at = now
        self.subscription_ends_at = self.trial_ends_at
        return True
    
    def end_trial(self):
        """End trial and revert to free plan"""
        if not self.is_on_trial:
            return False
        
        starter_plan = StoragePlan.query.filter_by(name='Starter', is_active=True).first()
        if starter_plan:
            self.storage_plan_id = starter_plan.id
            self.user_type = 'Starter'
        
        self.is_on_trial = False
        self.subscription_status = 'expired'
        self.trial_notified = False
        return True

    # =========================================================================
    # Analysis Quota Methods
    # =========================================================================

    def _get_analysis_limit(self):
        """Return daily_analysis_limit for this user's plan (default 10)."""
        plan_name = self.user_type or 'Starter'
        limit_row = AnalysisLimit.query.filter_by(plan_name=plan_name, is_active=True).first()
        return limit_row.daily_analysis_limit if limit_row else 10

    def _get_today_usage(self):
        """Return today's UserAnalysisUsage row, creating it if needed."""
        today = datetime.utcnow().date()
        usage = UserAnalysisUsage.query.filter_by(user_id=self.id, usage_date=today).first()
        if not usage:
            db.session.rollback() # Limpiar cualquier error previo
            now = datetime.utcnow()
            usage = UserAnalysisUsage(
                user_id=self.id,
                usage_date=today,
                analysis_count=0,
                last_reset_at=now,
                updated_at=now,
            )
            db.session.add(usage)
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
                # Re-intentar obtener por si otro proceso lo creó justo ahora
                usage = UserAnalysisUsage.query.filter_by(user_id=self.id, usage_date=today).first()
                if not usage:
                    raise
        return usage

    def can_perform_analysis(self):
        """True if the user still has quota for today."""
        usage = self._get_today_usage()
        return usage.analysis_count < self._get_analysis_limit()

    def get_remaining_analysis(self):
        """Remaining analyses for today."""
        usage = self._get_today_usage()
        return max(0, self._get_analysis_limit() - usage.analysis_count)

    def increment_analysis_count(self):
        """Increment today's counter. Returns True on success."""
        try:
            usage = self._get_today_usage()
            limit = self._get_analysis_limit()
            if usage.analysis_count >= limit:
                return False
            usage.analysis_count += 1
            if usage.analysis_count >= limit:
                usage.limit_reached_at = datetime.utcnow()
            db.session.commit()
            return True
        except Exception:
            db.session.rollback()
            return False

    def get_analysis_stats(self):
        """Return a stats dict consumed by analysis_tracker.js."""
        from datetime import datetime as dt
        usage   = self._get_today_usage()
        limit   = self._get_analysis_limit()
        used    = usage.analysis_count
        remaining = max(0, limit - used)
        pct     = (remaining / limit * 100) if limit else 0

        # Seconds until midnight UTC (daily reset)
        now = dt.utcnow()
        midnight = dt.combine(now.date(), dt.min.time()) + timedelta(days=1)
        reset_in_seconds = int((midnight - now).total_seconds())

        return {
            'used':             used,
            'limit':            limit,
            'remaining':        remaining,
            'percentage':       round(pct, 1),
            'reset_at':         midnight.isoformat(),
            'reset_in_seconds': reset_in_seconds,
            'limit_reached_at': usage.limit_reached_at.isoformat() if usage.limit_reached_at else None,
        }

    # =========================================================================
    # Utility Methods
    # =========================================================================

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'lastname': self.lastname,
            'avatar': self.avatar,
            'user_type': self.user_type,
            'isactive': self.isactive,
            'confirmed': self.confirmed,
            'oauth_provider': self.oauth_provider,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'settings': self.get_settings()
        }
    
    def get_settings(self):
        """Get user settings with defaults merged"""
        defaults = {
            'preferences': {
                'theme': 'light',
                'language': 'en',
                'compact_view': False
            },
            'notifications': {
                'email_digests': True,
                'browser_notifications': False
            },
            'workspace': {
                'auto_archive_docs': False,
                'default_folder_color': '#6d28d9',
                'share_link_expiry_days': 7,
            },
            'ai': {
                'creativity_level': 'balanced',
                'auto_suggest_titles': True
            }
        }
        if not self.settings_json:
            return defaults
        
        try:
            stored = json.loads(self.settings_json)
            # Deep merge defaults with stored (simple one-level merge here for brevity)
            for category, values in stored.items():
                if category in defaults:
                    defaults[category].update(values)
                else:
                    defaults[category] = values
            return defaults
        except:
            return defaults

    def update_settings(self, new_settings):
        """Update and persist user settings"""
        current = self.get_settings()
        # Merge new into current
        for category, values in new_settings.items():
            if category in current:
                current[category].update(values)
            else:
                current[category] = values
        
        self.settings_json = json.dumps(current)
        db.session.commit()
    
    @staticmethod
    def get_or_create(email, name=None):
        """Get or create user by email"""
        user = User.query.filter_by(email=email.lower().strip()).first()
        if not user:
            user = User(email=email, name=name)
            db.session.add(user)
            db.session.commit()
        return user
    
    def __repr__(self):
        return f'<User {self.email}>'


# ============================================================================
# MODELOS DE DOCUMENTO
# ============================================================================

class Document(db.Model):
    """Modelo principal de documento"""
    __tablename__ = 'marktrack_documents'
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False, default='Untitled')
    content_delta = db.Column(db.Text(4294967295), nullable=True)
    content_html = db.Column(db.Text(4294967295), nullable=True)
    minio_path = db.Column(db.String(255), nullable=True)
    storage_type = db.Column(db.String(20), default='database')
    size_bytes = db.Column(db.Integer, default=0)
    
    # Metadata
    document_type = db.Column(db.String(50), default='created')
    original_filename = db.Column(db.String(255), nullable=True)
    mime_type = db.Column(db.String(100), nullable=True)
    
    # Owner
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    # Version control
    version_number = db.Column(db.Integer, default=1)
    is_deleted = db.Column(db.Boolean, default=False)
    is_archived = db.Column(db.Boolean, default=False)
    
    # Folder relation
    folder_id = db.Column(db.Integer, db.ForeignKey('folders.id'), nullable=True)
    folder = db.relationship('Folder', backref=db.backref('documents', lazy='dynamic'))
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = db.Column(db.DateTime, nullable=True)

    # Yjs CRDT collaborative state (binary, stored as BLOB)
    # Populated by services/yjs_state_service.py when ≥2 collaborators are active
    yjs_state = db.Column(db.LargeBinary, nullable=True)
    
    # Relationships
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
            'is_archived': self.is_archived,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'owner_id': self.owner_id,
            'folder_id': self.folder_id,
            'owner_email': self.owner.email if self.owner else None,
            'shared': [s.shared_with_user.email for s in self.shares if getattr(s, 'shared_with_user', None)] if hasattr(self, 'shares') else []
        }
        
        if include_content and self.storage_type == 'database':
            data['delta'] = json.loads(self.content_delta) if self.content_delta else {}
            data['html'] = self.content_html or ''
        
        return data
    
    def soft_delete(self):
        self.is_deleted = True
        self.deleted_at = datetime.utcnow()
        db.session.commit()
    
    def restore(self):
        self.is_deleted = False
        self.is_archived = False
        self.deleted_at = None
        db.session.commit()


class DocumentVersion(db.Model):
    """Document version history"""
    __tablename__ = 'marktrack_document_versions'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)
    content_delta = db.Column(db.Text(4294967295))
    content_html = db.Column(db.Text(4294967295))
    minio_path = db.Column(db.String(255), nullable=True)
    size_bytes = db.Column(db.Integer, default=0)
    change_summary = db.Column(db.String(255), nullable=True)
    created_by = db.Column(db.String(100), nullable=True)
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
    """Document sharing"""
    __tablename__ = 'marktrack_document_shares'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    permission_level = db.Column(db.String(20), default='read')
    share_token = db.Column(db.String(100), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    access_count = db.Column(db.Integer, default=0)
    last_accessed_at = db.Column(db.DateTime, nullable=True)
    shared_by_email = db.Column(db.String(255), nullable=False)
    share_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    shared_with_user = db.relationship('User', foreign_keys=[user_id], back_populates='shared_documents')
    
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
            'user_email': self.shared_with_user.email if self.shared_with_user else None,
            'permission_level': self.permission_level,
            'share_token': self.share_token,
            'is_active': self.is_active,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'access_count': self.access_count,
            'shared_by_email': self.shared_by_email,
            'created_at': self.created_at.isoformat()
        }
    
    @property
    def is_expired(self):
        if self.expires_at:
            return datetime.utcnow() > self.expires_at
        return False
    
    def record_access(self):
        self.access_count += 1
        self.last_accessed_at = datetime.utcnow()
        db.session.commit()

class FolderShare(db.Model):
    """Folder sharing"""
    __tablename__ = 'marktrack_folder_shares'
    
    id = db.Column(db.Integer, primary_key=True)
    folder_id = db.Column(db.Integer, db.ForeignKey('folders.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    permission_level = db.Column(db.String(20), default='read')
    share_token = db.Column(db.String(100), unique=True, nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    access_count = db.Column(db.Integer, default=0)
    last_accessed_at = db.Column(db.DateTime, nullable=True)
    shared_by_email = db.Column(db.String(255), nullable=False)
    share_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = db.relationship('User', foreign_keys=[user_id])
    
    def __init__(self, **kwargs):
        super(FolderShare, self).__init__(**kwargs)
        if not self.share_token:
            self.share_token = str(uuid.uuid4())
        if not self.expires_at:
            self.expires_at = datetime.utcnow() + timedelta(days=7)
    
    def to_dict(self):
        return {
            'id': self.id,
            'folder_id': self.folder_id,
            'user_id': self.user_id,
            'user_email': self.user.email if hasattr(self, 'user') and self.user else None,
            'permission_level': self.permission_level,
            'share_token': self.share_token,
            'is_active': self.is_active,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'access_count': self.access_count,
            'shared_by_email': self.shared_by_email,
            'created_at': self.created_at.isoformat()
        }
    
    @property
    def is_expired(self):
        if self.expires_at:
            return datetime.utcnow() > self.expires_at
        return False
    
    def record_access(self):
        self.access_count += 1
        self.last_accessed_at = datetime.utcnow()
        db.session.commit()
    
    def revoke(self):
        self.is_active = False
        db.session.commit()


class DocumentActivity(db.Model):
    """Document activity log"""
    __tablename__ = 'marktrack_document_activities'
    
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False)
    user_email = db.Column(db.String(255), nullable=False)
    activity_type = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    user_agent = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    document = db.relationship('Document', backref='activities')
    
    def to_dict(self):
        return {
            'id': self.id,
            'document_id': self.document_id,
            'user_email': self.user_email,
            'activity_type': self.activity_type,
            'description': self.description,
            'created_at': self.created_at.isoformat()
        }
    
    @staticmethod
    def log_activity(document_id, user_email, activity_type, description=None, request=None):
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
        return activity


# ============================================================================
# END MODELOS DE DOCUMENTO (Before Workspace)
# ============================================================================

class EssaySubmissionMetrics(db.Model):
    """Métricas de evaluación del comportamiento de escritura de los estudiantes"""
    __tablename__ = 'essay_submission_metrics'

    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=True)
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=True)
    invitation_id = db.Column(db.Integer, db.ForeignKey('workspace_invitations.id', ondelete='CASCADE'), nullable=True)
    
    total_time_seconds = db.Column(db.Integer, default=0)
    effective_time_seconds = db.Column(db.Integer, default=0)
    keystrokes = db.Column(db.Integer, default=0)
    backspaces = db.Column(db.Integer, default=0)
    avg_hold_ms = db.Column(db.Float, default=0.0)
    avg_interkey_ms = db.Column(db.Float, default=0.0)
    long_pauses = db.Column(db.Integer, default=0)
    wpm = db.Column(db.Float, default=0.0)
    
    raw_logs = db.Column(db.JSON, nullable=True)  # Audit events only (max 200, ~5KB)
    session_metadata = db.Column(db.JSON, nullable=True)  # activity_by_minute + advanced counters
    quill_delta = db.Column(db.JSON, nullable=True)  # Legacy field: use marktrack_documents.content_delta instead
    signature_data = db.Column(db.Text(4294967295), nullable=True) 
    
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Performance: index invitation_id for the frequent UPSERT pattern
    __table_args__ = (
        Index('idx_esm_invitation_id', 'invitation_id'),
        Index('idx_esm_workspace_id', 'workspace_id'),
    )

    # Relaciones
    document = db.relationship('Document', backref='submission_metrics')
    invitation = db.relationship('WorkspaceInvitation', foreign_keys=[invitation_id], backref='submission_metrics')

    def to_dict(self):
        return {
            'id': self.id,
            'document_id': self.document_id,
            'workspace_id': self.workspace_id,
            'invitation_id': self.invitation_id,
            'student_name': f"{self.invitation.first_name or ''} {self.invitation.last_name or ''}".strip() if self.invitation else 'Anónimo',
            'student_email': self.invitation.email if self.invitation else None,
            'submitted_at': self.submitted_at.isoformat() if self.submitted_at else None,
            'total_time_seconds': self.total_time_seconds,
            'effective_time_seconds': self.effective_time_seconds,
            'keystrokes': self.keystrokes,
            'backspaces': self.backspaces,
            'avg_hold_ms': round(self.avg_hold_ms, 2) if self.avg_hold_ms else 0,
            'avg_interkey_ms': round(self.avg_interkey_ms, 2) if self.avg_interkey_ms else 0,
            'long_pauses': self.long_pauses,
            'wpm': round(self.wpm, 1) if self.wpm else 0,
            'session_metadata': self.session_metadata or {},
            # raw_logs se excluye del to_dict() por defecto para ahorrar ancho de banda.
            # Acceder a self.raw_logs directamente en los endpoints que lo necesiten.
            'has_signature': True if self.signature_data else False
        }

# ============================================================================
# MODELOS DE WORKSPACE COLABORATIVO
# ============================================================================

class Workspace(db.Model):
    """Espacio colaborativo con acceso por invitación"""
    __tablename__ = 'workspaces'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    classroom = db.Column(db.String(255), nullable=True)
    start_date = db.Column(db.DateTime, nullable=False)
    deadline = db.Column(db.DateTime, nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    is_closed = db.Column(db.Boolean, default=False)
    closed_at = db.Column(db.DateTime, nullable=True)
    has_word_limit = db.Column(db.Boolean, default=False)
    word_limit = db.Column(db.Integer, nullable=True)
    allow_extensions = db.Column(db.Boolean, default=True)          # feature flag
    extension_window_hours = db.Column(db.Integer, default=48)      # hours after deadline
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    owner = db.relationship('User', backref=db.backref('workspaces', lazy='dynamic'))
    invitations = db.relationship('WorkspaceInvitation', backref='workspace', cascade='all, delete-orphan', lazy='dynamic')
    submission_metrics = db.relationship('EssaySubmissionMetrics', backref='workspace_ref', cascade='all, delete-orphan', lazy='dynamic')

    __table_args__ = (
        Index('idx_workspace_owner', 'owner_id'),
        Index('idx_workspace_deadline', 'deadline'),
    )

    def get_progress(self):
        """Calculate percentage of students who completed registration"""
        total = self.invitations.count()
        if total == 0:
            return 0
        active = self.invitations.filter_by(status='active').count()
        return round((active / total) * 100)

    def check_deadline(self):
        """Check and auto-close if deadline has passed"""
        if not self.is_closed and datetime.utcnow() > self.deadline:
            self.is_closed = True
            db.session.commit()
        return self.is_closed

    def to_dict(self):
        total_invitations = self.invitations.count()
        active_invitations = self.invitations.filter_by(status='active').count()
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'classroom': self.classroom,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'deadline': self.deadline.isoformat() if self.deadline else None,
            'owner_id': self.owner_id,
            'is_closed': self.check_deadline(),
            'closed_at': self.closed_at.isoformat() if self.closed_at else None,
            'has_word_limit': getattr(self, 'has_word_limit', False),
            'word_limit': getattr(self, 'word_limit', None),
            'progress': self.get_progress(),
            'total_invited': total_invitations,
            'total_active': active_invitations,
            'invitations': [inv.to_dict_summary() for inv in self.invitations.all()],
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class WorkspaceInvitation(db.Model):
    """Invitación individual por email a un workspace"""
    __tablename__ = 'workspace_invitations'

    id = db.Column(db.Integer, primary_key=True)
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    email = db.Column(db.String(255), nullable=False)
    token = db.Column(db.String(128), unique=True, nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, active, blocked
    first_name = db.Column(db.String(100), nullable=True)
    last_name = db.Column(db.String(100), nullable=True)
    sent_at = db.Column(db.DateTime, nullable=True)
    accessed_at = db.Column(db.DateTime, nullable=True)
    extended_deadline = db.Column(db.DateTime, nullable=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    document = db.relationship('Document', backref='workspace_invitation')

    __table_args__ = (
        Index('idx_invitation_token', 'token'),
        Index('idx_invitation_workspace', 'workspace_id'),
        Index('idx_invitation_email', 'email'),
    )

    def __init__(self, **kwargs):
        super(WorkspaceInvitation, self).__init__(**kwargs)
        if not self.token:
            self.token = secrets.token_urlsafe(32)

    def to_dict_summary(self):
        """Compact dict for workspace card avatars"""
        return {
            'id': self.id,
            'email': self.email,
            'status': self.status,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'initial': (self.email[0] if self.email else '?').upper()
        }

    def to_dict(self):
        doc_data = None
        if self.document:
            doc_data = {
                'id': self.document.id,
                'title': self.document.title,
                'size_bytes': self.document.size_bytes,
                'document_type': self.document.document_type,
                'storage_type': self.document.storage_type,
                'updated_at': self.document.updated_at.isoformat()
            }
            
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'email': self.email,
            'token': self.token,
            'status': self.status,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
            'accessed_at': self.accessed_at.isoformat() if self.accessed_at else None,
            'extended_deadline': self.extended_deadline.isoformat() if self.extended_deadline else None,
            'document_id': self.document_id,
            'document': doc_data,
            'created_at': self.created_at.isoformat()
        }


class WorkspaceExtensionLog(db.Model):
    """Auditoría de reaperturas y extensiones individuales/globales de tiempo"""
    __tablename__ = 'workspace_extension_logs'

    id = db.Column(db.Integer, primary_key=True)
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    invitation_id = db.Column(db.Integer, db.ForeignKey('workspace_invitations.id', ondelete='CASCADE'), nullable=True)
    action = db.Column(db.String(50), nullable=False)  # 'MANUAL_CLOSE', 'GLOBAL_REOPEN', 'INDIVIDUAL_EXTENSION'
    previous_deadline = db.Column(db.DateTime, nullable=True)
    new_deadline = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    workspace = db.relationship('Workspace', backref=db.backref('extension_logs', lazy='dynamic', cascade='all, delete-orphan'))
    invitation = db.relationship('WorkspaceInvitation', backref=db.backref('extension_logs', lazy='dynamic'))
    creator = db.relationship('User', foreign_keys=[created_by])


# ============================================================================
# MODELOS COLABORATIVOS — EDITOR ACADÉMICO
# Sesión 1: Definición de modelos. Las tablas se crean con db.create_all().
# ============================================================================

class NotificationType(enum.Enum):
    """Tipos de notificación del sistema académico colaborativo."""
    # Colaboración (estudiante)
    COLLABORATION_INVITE  = "collaboration_invite"
    SECTION_EDITED        = "section_edited"
    SECTION_ASSIGNED      = "section_assigned"
    TEAM_FORMED           = "team_formed"
    # Feedback (estudiante ↔ profesor)
    COMMENT_ADDED         = "comment_added"
    COMMENT_REPLIED       = "comment_replied"
    COMMENT_RESOLVED      = "comment_resolved"
    FEEDBACK_REQUESTED    = "feedback_requested"
    # Documento / progreso
    DOCUMENT_COMPLETE     = "document_complete"
    REVIEW_MODE_ACTIVATED = "review_mode_activated"
    DEADLINE_REMINDER     = "deadline_reminder"
    # Gamificación
    BADGE_AWARDED         = "badge_awarded"
    RANKING_UPDATE        = "ranking_update"
    # IA y sistema
    AI_SUGGESTION         = "ai_suggestion"
    PLAGIARISM_ALERT      = "plagiarism_alert"
    FOCUS_SESSION_LONG    = "focus_session_long"
    SYSTEM_UPDATE         = "system_update"
    MENTION               = "mention"
    PEER_REVIEW_INVITE    = "peer_review_invite"
    # Compartición directa (nuevo)
    SHARE_RECEIVED        = "share_received"
    # Prórroga (extension request)
    EXTENSION_REQUESTED   = "extension_requested"
    EXTENSION_APPROVED    = "extension_approved"
    EXTENSION_REJECTED    = "extension_rejected"


class Notification(db.Model):
    """
    Notificación individual para un usuario.

    El campo metadata_ almacena datos contextuales en JSON
    (document_id, section_id, badge_name, etc.) para que el frontend
    pueda construir deep-links y acciones rápidas sin consultas extra.
    """
    __tablename__ = 'notifications'

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student_workspace_users.id', ondelete='CASCADE'), nullable=True, index=True)
    type       = db.Column(db.Enum(NotificationType), nullable=False)
    title      = db.Column(db.String(200), nullable=False)
    message    = db.Column(db.Text, nullable=False)
    url        = db.Column(db.String(500), nullable=True)       # deep-link al recurso
    read       = db.Column(db.Boolean, default=False, nullable=False)
    priority   = db.Column(db.Integer, default=2)               # 1=crítica, 2=normal, 3=info
    metadata_  = db.Column('metadata', db.JSON, nullable=True)  # datos extra (document_id, etc.)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user    = db.relationship('User', backref=db.backref('notifications', lazy='dynamic'))
    student = db.relationship('StudentWorkspaceUser', backref=db.backref('notifications', lazy='dynamic'))

    __table_args__ = (
        Index('idx_notif_user_read', 'user_id', 'read'),
        Index('idx_notif_student_read', 'student_id', 'read'),
        Index('idx_notif_created', 'created_at'),
    )

    def to_dict(self) -> dict:
        """Serializa la notificación para el dropdown y la API."""
        from datetime import timezone

        def time_ago(dt: datetime) -> str:
            now = datetime.utcnow()
            diff = now - dt
            seconds = int(diff.total_seconds())
            if seconds < 60:
                return "just now"
            if seconds < 3600:
                return f"{seconds // 60} min ago"
            if seconds < 86400:
                return f"{seconds // 3600} h ago"
            return f"{seconds // 86400} d ago"

        # Categoría para el filtro del dropdown
        category_map = {
            NotificationType.COLLABORATION_INVITE: 'collaboration',
            NotificationType.SECTION_EDITED:       'collaboration',
            NotificationType.SECTION_ASSIGNED:     'collaboration',
            NotificationType.TEAM_FORMED:          'collaboration',
            NotificationType.COMMENT_ADDED:        'feedback',
            NotificationType.COMMENT_REPLIED:      'feedback',
            NotificationType.COMMENT_RESOLVED:     'feedback',
            NotificationType.FEEDBACK_REQUESTED:   'feedback',
            # Share
            NotificationType.SHARE_RECEIVED:        'collaboration',
        }
        category = category_map.get(self.type, 'system')

        return {
            'id':         self.id,
            'user_id':    self.user_id,
            'student_id': self.student_id,
            'type':       self.type.value,
            'category':   category,
            'title':      self.title,
            'message':    self.message,
            'url':        self.url,
            'read':       self.read,
            'priority':   self.priority,
            'metadata':   self.metadata_ or {},
            'timestamp':  self.created_at.isoformat(),
            'time_ago':   time_ago(self.created_at),
        }


class UserNotificationPreference(db.Model):
    """
    Preferencias de notificación por usuario.

    muted_until: silencia TODAS las notificaciones hasta esa fecha.
    muted_courses: lista de workspace_id (cursos) silenciados [int, ...].
    muted_types: lista de NotificationType.value silenciados ["comment_added", ...].
    """
    __tablename__ = 'user_notification_preferences'

    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    muted_until   = db.Column(db.DateTime, nullable=True)
    muted_courses = db.Column(db.JSON, default=list)
    muted_types   = db.Column(db.JSON, default=list)
    daily_digest  = db.Column(db.Boolean, default=True)
    sound_enabled = db.Column(db.Boolean, default=False)
    email_enabled = db.Column(db.Boolean, default=False)
    updated_at    = db.Column(db.DateTime, onupdate=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('notification_preference', uselist=False))


class DocumentComment(db.Model):
    """
    Comentario inline del profesor sobre un fragmento de texto en Quill.js.

    selection_from / selection_to: índices de caracteres en el delta de Quill
    (equivalente a ProseMirror positions). El frontend usa estos valores para
    aplicar el formato de resaltado al abrir el documento.
    parent_id: permite threading (respuestas a un comentario).
    """
    __tablename__ = 'document_comments'

    id            = db.Column(db.Integer, primary_key=True)
    document_id   = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False, index=True)
    author_id     = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    text          = db.Column(db.Text, nullable=False)
    selection_from = db.Column(db.Integer, nullable=True)
    selection_to   = db.Column(db.Integer, nullable=True)
    color         = db.Column(db.String(7), default='#FDE68A')  # hex color del resaltado
    resolved      = db.Column(db.Boolean, default=False)
    resolved_by   = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    resolved_at   = db.Column(db.DateTime, nullable=True)
    parent_id     = db.Column(db.Integer, db.ForeignKey('document_comments.id'), nullable=True)
    page_index    = db.Column(db.Integer, nullable=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    author   = db.relationship('User', foreign_keys=[author_id], backref=db.backref('comments_authored', lazy='dynamic'))
    resolver = db.relationship('User', foreign_keys=[resolved_by])
    replies  = db.relationship('DocumentComment', backref=db.backref('parent', remote_side='DocumentComment.id'), lazy='dynamic')
    document = db.relationship('Document', backref=db.backref('comments', lazy='dynamic', cascade='all, delete-orphan'))

    def to_dict(self) -> dict:
        return {
            'id':             self.id,
            'document_id':    self.document_id,
            'author_id':      self.author_id,
            'author_name':    f"{self.author.name or ''} {self.author.lastname or ''}".strip() if self.author else 'Anónimo',
            'author_email':   self.author.email if self.author else None,
            'text':           self.text,
            'selection_from': self.selection_from,
            'selection_to':   self.selection_to,
            'color':          self.color,
            'resolved':       self.resolved,
            'parent_id':      self.parent_id,
            'page_index':     self.page_index,
            'created_at':     self.created_at.isoformat(),
            'resolved_at':    self.resolved_at.isoformat() if self.resolved_at else None,
        }


class DocumentSection(db.Model):
    """
    Sección del documento asignada a un miembro del equipo.

    Se usa en la vista de colaboración para dividir el trabajo.
    status: 'in_progress' | 'ready' | 'reviewed'
    progress: 0-100 calculado por el frontend según palabras escritas.
    """
    __tablename__ = 'document_sections'

    id          = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False, index=True)
    title       = db.Column(db.String(200), nullable=False)
    assigned_to = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    order_index = db.Column(db.Integer, default=0)
    status      = db.Column(db.String(50), default='in_progress')
    progress    = db.Column(db.Integer, default=0)

    assignee = db.relationship('User', foreign_keys=[assigned_to], backref=db.backref('assigned_sections', lazy='dynamic'))
    document = db.relationship('Document', backref=db.backref('sections', lazy='dynamic'))

    def to_dict(self) -> dict:
        return {
            'id':          self.id,
            'document_id': self.document_id,
            'title':       self.title,
            'assigned_to': self.assigned_to,
            'order_index': self.order_index,
            'status':      self.status,
            'progress':    self.progress,
        }


class DocumentCollaborator(db.Model):
    """
    Miembro del equipo de un documento con su rol.

    role: 'owner' | 'editor' | 'collaborator' | 'reader'
    - owner: quien creó el documento (puede haber 1 por documento)
    - editor: editor principal con permisos de escritura total
    - collaborator: editor colaborador (máx. escritura en sus secciones asignadas)
    - reader: solo lectura (usado para profesores que acceden vía review)
    accepted: False = invitación pendiente, True = aceptada
    """
    __tablename__ = 'document_collaborators'

    id          = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False, index=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    role        = db.Column(db.Enum('owner', 'editor', 'collaborator', 'reader', name='collab_role'), default='collaborator')
    invited_by  = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    accepted    = db.Column(db.Boolean, default=False)
    accepted_at = db.Column(db.DateTime, nullable=True)
    joined_at   = db.Column(db.DateTime, default=datetime.utcnow)

    user     = db.relationship('User', foreign_keys=[user_id], backref=db.backref('document_collaborations', lazy='dynamic'))
    inviter  = db.relationship('User', foreign_keys=[invited_by])
    document = db.relationship('Document', backref=db.backref('collaborators', lazy='dynamic'))

    __table_args__ = (
        db.UniqueConstraint('document_id', 'user_id', name='uq_doc_collaborator'),
        Index('idx_collab_document', 'document_id'),
        Index('idx_collab_user', 'user_id'),
    )

    def to_dict(self) -> dict:
        return {
            'id':          self.id,
            'document_id': self.document_id,
            'user_id':     self.user_id,
            'user_email':  self.user.email if self.user else None,
            'user_name':   f"{self.user.name or ''} {self.user.lastname or ''}".strip() if self.user else 'Anónimo',
            'role':        self.role,
            'accepted':    self.accepted,
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'joined_at':   self.joined_at.isoformat() if self.joined_at else None,
        }


class ContributionSnapshot(db.Model):
    """
    Snapshot de quién escribió qué en cada guardado del documento.

    Cada vez que el autosave dispara, se registra un snapshot por usuario activo
    con los deltas de inserción/eliminación/formato desde el último snapshot.
    Esto alimenta el panel de actividad y el historial de contribuciones.

    action: 'insert' | 'delete' | 'format'
    word_count_delta: positivo si agregó palabras, negativo si eliminó.
    """
    __tablename__ = 'contribution_snapshots'

    id               = db.Column(db.Integer, primary_key=True)
    document_id      = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id'), nullable=False, index=True)
    user_id          = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    action           = db.Column(db.String(20), nullable=False)   # 'insert' | 'delete' | 'format'
    content          = db.Column(db.Text, nullable=True)          # texto afectado (truncado a 500 chars)
    position_from    = db.Column(db.Integer, nullable=True)
    position_to      = db.Column(db.Integer, nullable=True)
    word_count_delta = db.Column(db.Integer, default=0)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    user     = db.relationship('User', backref=db.backref('contributions', lazy='dynamic'))
    document = db.relationship('Document', backref=db.backref('contribution_snapshots', lazy='dynamic'))

    __table_args__ = (
        Index('idx_contrib_doc_user', 'document_id', 'user_id'),
        Index('idx_contrib_created', 'document_id', 'created_at'),
    )

    def to_dict(self) -> dict:
        return {
            'id':               self.id,
            'document_id':      self.document_id,
            'user_id':          self.user_id,
            'user_name':        f"{self.user.name or ''} {self.user.lastname or ''}".strip() if self.user else 'Anónimo',
            'action':           self.action,
            'content':          self.content,
            'position_from':    self.position_from,
            'position_to':      self.position_to,
            'word_count_delta': self.word_count_delta,
            'created_at':       self.created_at.isoformat(),
        }


# ============================================================================
# STUDENT WORKSPACE USERS — Isolated auth domain (never mixed with User)
# ============================================================================

class StudentWorkspaceUser(db.Model):
    """
    Lightweight student account created during workspace invite registration.
    Completely isolated from the main User model.
    One student can be linked to multiple invitations (multi-workspace ready).
    Auth uses Flask session, NOT Flask-Login.
    """
    __tablename__ = 'student_workspace_users'

    id            = db.Column(db.Integer, primary_key=True)
    email         = db.Column(db.String(255), nullable=False, index=True)
    first_name    = db.Column(db.String(120), nullable=True)
    last_name     = db.Column(db.String(120), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active     = db.Column(db.Boolean, default=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    last_login    = db.Column(db.DateTime, nullable=True)
    settings_json = db.Column(db.Text, nullable=True)  # Centralized student settings

    # Linked to the specific invitation (source of workspace context)
    invitation_id = db.Column(
        db.Integer,
        db.ForeignKey('workspace_invitations.id', ondelete='SET NULL'),
        nullable=True,
        index=True
    )
    invitation = db.relationship(
        'WorkspaceInvitation',
        backref=db.backref('student_accounts', lazy='dynamic')
    )

    __table_args__ = (
        Index('idx_student_email', 'email'),
        Index('idx_student_invitation', 'invitation_id'),
    )

    def set_password(self, raw_password: str) -> None:
        from werkzeug.security import generate_password_hash
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password: str) -> bool:
        from werkzeug.security import check_password_hash
        return check_password_hash(self.password_hash, raw_password)

    @property
    def full_name(self) -> str:
        return f"{self.first_name or ''} {self.last_name or ''}".strip() or self.email

    @property
    def initials(self) -> str:
        parts = self.full_name.split()
        if len(parts) >= 2:
            return (parts[0][0] + parts[-1][0]).upper()
        return self.full_name[0].upper() if self.full_name else '?'

    def to_dict(self) -> dict:
        return {
            'id':         self.id,
            'email':      self.email,
            'first_name': self.first_name,
            'last_name':  self.last_name,
            'full_name':  self.full_name,
            'initials':   self.initials,
            'is_active':  self.is_active,
            'created_at': self.created_at.isoformat(),
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'settings':   self.get_settings()
        }

    def get_settings(self):
        """Get student settings with defaults merged"""
        import json
        defaults = {
            'preferences': {
                'language': 'en',
                'compact_view': False
            },
            'notifications': {
                'email_alerts': True,
                'sounds_enabled': True
            }
        }
        if not self.settings_json:
            return defaults
        try:
            stored = json.loads(self.settings_json)
            # Simple merge
            for category, values in stored.items():
                if category in defaults:
                    defaults[category].update(values)
                else:
                    defaults[category] = values
            return defaults
        except:
            return defaults

    def update_settings(self, new_settings):
        """Update and persist student settings"""
        import json
        current = self.get_settings()
        for category, values in new_settings.items():
            if category in current:
                current[category].update(values)
            else:
                current[category] = values
        self.settings_json = json.dumps(current)
        from settings.extensions import db
        db.session.commit()


# ============================================================================
# EXTENSION REQUEST — Student prórroga flow
# ============================================================================

class ExtensionRequestReason(enum.Enum):
    HEALTH      = "health"
    TECHNICAL   = "technical"
    FAMILY      = "family"
    OVERLOAD    = "overload"
    ERROR       = "error"
    OTHER       = "other"


class ExtensionRequestStatus(enum.Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ExtensionRequest(db.Model):
    """
    Solicitud de prórroga enviada por un estudiante para un workspace cerrado.

    Reglas de negocio:
    - Máximo 1 por (student_id, invitation_id)  → UniqueConstraint
    - Solo permitida si workspace.allow_extensions = True
    - Solo dentro de deadline + workspace.extension_window_hours
    - Al aprobar: invitation.extended_deadline = new_deadline
                  workspace reopen (is_closed=False si la fecha es futura)
    """
    __tablename__ = 'extension_requests'

    id            = db.Column(db.Integer, primary_key=True)
    student_id    = db.Column(db.Integer, db.ForeignKey('student_workspace_users.id', ondelete='CASCADE'), nullable=False, index=True)
    invitation_id = db.Column(db.Integer, db.ForeignKey('workspace_invitations.id', ondelete='CASCADE'), nullable=False, index=True)

    reason        = db.Column(db.Enum(ExtensionRequestReason), nullable=False)
    description   = db.Column(db.Text, nullable=True)   # required when reason=OTHER
    evidence_url  = db.Column(db.String(500), nullable=True)

    status        = db.Column(db.Enum(ExtensionRequestStatus), default=ExtensionRequestStatus.PENDING, nullable=False)

    requested_at  = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at   = db.Column(db.DateTime, nullable=True)
    reviewed_by   = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    new_deadline   = db.Column(db.DateTime, nullable=True)
    review_comment = db.Column(db.Text, nullable=True)

    # Relationships
    student    = db.relationship('StudentWorkspaceUser', backref=db.backref('extension_requests', lazy='dynamic'))
    invitation = db.relationship('WorkspaceInvitation', backref=db.backref('extension_requests', lazy='dynamic'))
    reviewer   = db.relationship('User', foreign_keys=[reviewed_by])

    __table_args__ = (
        db.UniqueConstraint('student_id', 'invitation_id', name='uq_ext_req_student_inv'),
        Index('idx_ext_req_invitation', 'invitation_id'),
        Index('idx_ext_req_status', 'status'),
    )

    def to_dict(self) -> dict:
        inv = self.invitation
        ws  = inv.workspace if inv else None
        stu = self.student
        return {
            'id':             self.id,
            'student_id':     self.student_id,
            'student_name':   stu.full_name if stu else None,
            'student_email':  stu.email if stu else None,
            'invitation_id':  self.invitation_id,
            'workspace_id':   ws.id if ws else None,
            'workspace_title':ws.title if ws else None,
            'reason':         self.reason.value,
            'description':    self.description,
            'evidence_url':   self.evidence_url,
            'status':         self.status.value,
            'requested_at':   self.requested_at.isoformat(),
            'reviewed_at':    self.reviewed_at.isoformat() if self.reviewed_at else None,
            'reviewed_by':    self.reviewed_by,
            'new_deadline':   self.new_deadline.isoformat() if self.new_deadline else None,
            'review_comment': self.review_comment,
        }