"""
settings/config.py — PhD-grade Flask configuration
====================================================
ALL secrets loaded from environment variables.
SQLAlchemy engine tuned for mysqlclient + ProxySQL.
Redis URL environment-aware for Docker networking.
"""
import os
from datetime import timedelta

basedir = os.path.abspath(os.path.dirname(__file__))


def _env(key: str, default: str = "") -> str:
    """Read env var; raise loudly in production if missing."""
    val = os.environ.get(key, default)
    return val


class Config:
    # ── Security ──────────────────────────────────────────────────────────────
    SECRET_KEY                = _env("SECRET_KEY", "change-me-in-production")
    SECURITY_PASSWORD_SALT    = _env("SECURITY_PASSWORD_SALT", "change-salt-in-production")
    REMEMBER_COOKIE_SAMESITE  = "strict"
    SESSION_COOKIE_SAMESITE   = "strict"
    SESSION_COOKIE_HTTPONLY   = True
    SESSION_COOKIE_SECURE     = False          # override True in ProductionConfig
    PERMANENT_SESSION_LIFETIME = timedelta(days=30)
    APP_BASE_URL              = _env("APP_BASE_URL", "http://localhost:5000")

    # ── SQLAlchemy core ───────────────────────────────────────────────────────
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_COMMIT_ON_OPTIONS   = True
    # Pool tuned for Gunicorn + eventlet (sync driver path):
    #   pool_size        = steady-state connections kept open per process
    #   max_overflow     = burst capacity above pool_size
    #   pool_pre_ping    = discard stale connections silently
    #   pool_recycle     = force-recycle connections older than N seconds
    #                      (< MySQL's wait_timeout of 28 800 s)
    #   pool_timeout     = seconds to wait for a free connection before raising
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size":        10,
        "max_overflow":     20,
        "pool_pre_ping":    True,
        "pool_recycle":     1800,
        "pool_timeout":     10,
        "connect_args": {
            # mysqlclient C-level read/write timeouts (seconds)
            "connect_timeout": 5,
            "read_timeout":    30,
            "write_timeout":   30,
            # Charset: utf8mb4 for full Unicode support
            "charset": "utf8mb4",
        },
    }

    # ── AI ────────────────────────────────────────────────────────────────────
    GEMINI_API_KEY = _env("GEMINI_API_KEY")

    # ── Document editor ───────────────────────────────────────────────────────
    MAX_DB_SIZE         = 50_000
    MAX_DOCUMENT_SIZE   = 10 * 1024 * 1024   # 10 MB
    AUTO_SAVE_DELAY     = 2_000
    KEEP_VERSIONS       = 10

    # ── Flask-Caching (Redis, with msgpack compression) ───────────────────────
    # CACHE_TYPE and CACHE_REDIS_URL are set dynamically in extensions.py
    # so that the fallback to SimpleCache still works in dev without Redis.
    CACHE_DEFAULT_TIMEOUT  = 300
    CACHE_KEY_PREFIX       = "mktrk:"
    # CACHE_OPTIONS is set per-backend in extensions.py (Redis only)
    # Do NOT set it here — SimpleCache rejects unknown kwargs

    # ── Redis ─────────────────────────────────────────────────────────────────
    # Use REDIS_URL for all Redis clients.  Docker Compose sets this to
    # redis://redis:6379 automatically; falls back to localhost for local dev.
    REDIS_URL  = _env("REDIS_URL", "redis://localhost:6379")

    # Individual DBs:
    #   /0 → Flask-Caching
    #   /1 → redis_client (app logic, rate limiter)
    #   /2 → SocketIO message queue
    #   /3 → dogpile.cache ORM region
    @property
    def REDIS_CACHE_URL(self):     return self.REDIS_URL + "/0"
    @property
    def REDIS_CLIENT_URL(self):    return self.REDIS_URL + "/1"
    @property
    def REDIS_SOCKETIO_URL(self):  return self.REDIS_URL + "/2"
    @property
    def REDIS_DOGPILE_URL(self):   return self.REDIS_URL + "/3"

    # ── Mail ──────────────────────────────────────────────────────────────────
    # Multi-provider configuration for robust delivery
    MAIL_PROVIDERS = {
        'noreply': {
            'MAIL_SERVER':   "74.208.5.2",           # smtp.ionos.com (Direct IP for macOS DNS bypass)
            'MAIL_PORT':     587,
            'MAIL_USE_SSL':  False,
            'MAIL_USE_TLS':  True,
            'MAIL_USERNAME': "noreply@XplagiaX.ca",
            'MAIL_PASSWORD': "MYR1xkd2kqc_gat2hem",
            'MAIL_DEFAULT_SENDER': ("XplagiaX - MarkTrack", "noreply@XplagiaX.ca")
        },
        'gmail': {
            'MAIL_SERVER':   "smtp.gmail.com",
            'MAIL_PORT':     465,
            'MAIL_USE_SSL':  True,
            'MAIL_USE_TLS':  False,
            'MAIL_USERNAME': "xplagiax@gmail.com",
            'MAIL_PASSWORD': "akkv bxvl nmui sbws",
            'MAIL_DEFAULT_SENDER': ("XplagiaX Support", "xplagiax@gmail.com")
        }
    }

    # Primary defaults (sync with flask-mail extension)
    MAIL_SERVER         = MAIL_PROVIDERS['noreply']['MAIL_SERVER']
    MAIL_PORT           = MAIL_PROVIDERS['noreply']['MAIL_PORT']
    MAIL_USE_SSL        = MAIL_PROVIDERS['noreply']['MAIL_USE_SSL']
    MAIL_USE_TLS        = MAIL_PROVIDERS['noreply']['MAIL_USE_TLS']
    MAIL_USERNAME       = MAIL_PROVIDERS['noreply']['MAIL_USERNAME']
    MAIL_PASSWORD       = MAIL_PROVIDERS['noreply']['MAIL_PASSWORD']
    MAIL_DEFAULT_SENDER = MAIL_PROVIDERS['noreply']['MAIL_DEFAULT_SENDER']

    # ── Upload ────────────────────────────────────────────────────────────────
    UPLOAD_FOLDER       = os.path.join(basedir, "..", "uploads")
    MAX_CONTENT_LENGTH  = 16 * 1024 * 1024   # 16 MB
    ALLOWED_EXTENSIONS  = {"doc", "docx", "pdf", "txt", "png", "jpg", "jpeg", "gif"}

    # ── SeaweedFS ─────────────────────────────────────────────────────────────
    SEAWEEDFS_FILER_URL  = _env("SEAWEEDFS_FILER_URL",  "localhost:8888")
    SEAWEEDFS_MASTER_URL = _env("SEAWEEDFS_MASTER_URL", "localhost:9333")
    SEAWEEDFS_SECURE     = _env("SEAWEEDFS_SECURE", "false").lower() == "true"
    # Legacy alias
    MINIO_ENDPOINT = SEAWEEDFS_FILER_URL
    MINIO_SECURE   = SEAWEEDFS_SECURE

    # ── Share links ───────────────────────────────────────────────────────────
    SHARE_LINK_EXPIRY_HOURS = 24 * 7   # 7 days

    @staticmethod
    def init_app(app):
        os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)


def _detect_mysql_driver() -> str:
    """
    Auto-detect the best available MySQL driver.
    • mysqlclient (MySQLdb) — C extension, 3-5x faster; needs libmysqlclient-dev
    • pymysql          — pure Python fallback, always available in local venv
    Docker image installs mysqlclient; local dev venv typically has only pymysql.
    """
    try:
        import MySQLdb  # noqa: F401
        return "mysql+mysqldb"
    except ImportError:
        return "mysql+pymysql"


class DevelopmentConfig(Config):
    DEBUG = True
    # Driver auto-detected: mysqlclient in Docker, pymysql in local venv.
    # Override via DATABASE_URL env var for full control.
    SQLALCHEMY_DATABASE_URI = _env(
        "DATABASE_URL",
        f"{_detect_mysql_driver()}://root:@localhost/xplagiax_db?charset=utf8mb4"
    )
    # Smaller pool in dev — no point holding 10 idle connections
    SQLALCHEMY_ENGINE_OPTIONS = {
        **Config.SQLALCHEMY_ENGINE_OPTIONS,
        "pool_size":     3,
        "max_overflow":  5,
        "echo":          False,   # flip to True for raw SQL query trace
    }


class TestingConfig(Config):
    TESTING = True
    PRESERVE_CONTEXT_ON_EXCEPTION = False
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}    # SQLite doesn't support pool options
    WTF_CSRF_ENABLED = False


class ProductionConfig(Config):
    DEBUG   = False
    TESTING = False
    SESSION_COOKIE_SECURE = True

    # In production the app talks to ProxySQL (port 6033),
    # which handles read/write splitting to MySQL.
    SQLALCHEMY_DATABASE_URI = _env(
        "DATABASE_URL",
        # fallback for manual override without ProxySQL
        "mysql+mysqldb://user:password@proxysql:6033/xplagiax_db?charset=utf8mb4"
    )
    SQLALCHEMY_ENGINE_OPTIONS = {
        **Config.SQLALCHEMY_ENGINE_OPTIONS,
        "pool_size":     20,
        "max_overflow":  40,
        "pool_recycle":  900,    # shorter recycle behind ProxySQL
    }

    @classmethod
    def init_app(cls, app):
        Config.init_app(app)
        # Raise on missing critical secrets in production
        for key in ("SECRET_KEY", "SECURITY_PASSWORD_SALT", "MAIL_PASSWORD"):
            if not app.config.get(key) or app.config[key].startswith("change-"):
                import logging
                logging.getLogger(__name__).warning(
                    f"[SECURITY] {key} is using an insecure default in production!"
                )


Config = {
    "development": DevelopmentConfig,
    "testing":     TestingConfig,
    "production":  ProductionConfig,
    "default":     DevelopmentConfig,
}
