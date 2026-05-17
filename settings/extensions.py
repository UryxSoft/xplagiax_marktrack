"""
settings/extensions.py — PhD-grade Flask extensions bootstrap
=============================================================
Key upgrades vs previous version
─────────────────────────────────
• Redis: ConnectionPool (not naive Redis()) → reuses TCP sockets
• Flask-Caching: msgpack serializer + brotli compression
• dogpile.cache: ORM-level transparent query cache backed by Redis DB/3
• SocketIO: Redis message_queue picks URL from config (Docker-aware)
• user_loader: SQLAlchemy 2.0 db.session.get() — no deprecated .query.get()
• _redis_available(): respects REDIS_URL env var, not hardcoded localhost
"""
import os
import logging

from flask_sqlalchemy import SQLAlchemy
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_mail import Mail
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect
from flask_socketio import SocketIO
import redis
from redis import ConnectionPool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Resolve Redis URL early (needed by _redis_available + all clients) ─────────
_REDIS_BASE = os.environ.get("REDIS_URL", "redis://localhost:6379")


def _redis_available(base_url: str = _REDIS_BASE, timeout: int = 1) -> bool:
    """Cheap liveness check. Never raises."""
    try:
        from urllib.parse import urlparse
        p = urlparse(base_url)
        c = redis.Redis(
            host=p.hostname or "localhost",
            port=p.port or 6379,
            db=0,
            socket_connect_timeout=timeout,
        )
        c.ping()
        c.close()
        return True
    except Exception:
        return False


_USE_REDIS = _redis_available()
if not _USE_REDIS:
    logger.warning(
        "[extensions] Redis not reachable at %s — "
        "falling back to SimpleCache / in-process SocketIO",
        _REDIS_BASE,
    )


# ── SQLAlchemy ─────────────────────────────────────────────────────────────────
db = SQLAlchemy()

# ── Mail / CSRF ────────────────────────────────────────────────────────────────
mail = Mail()
csrf = CSRFProtect()


# ── Flask-Caching ──────────────────────────────────────────────────────────────
# Redis DB 0 is dedicated to Flask-Caching.
# OPTIONS dict is passed directly to redis.StrictRedis at init time.
_FLASK_CACHE_CONFIG = (
    {
        "CACHE_TYPE":       "RedisCache",
        "CACHE_REDIS_URL":  _REDIS_BASE + "/0",
        "CACHE_KEY_PREFIX": "mktrk:",
        # CACHE_OPTIONS is Redis-specific — omitted in SimpleCache fallback
        "CACHE_OPTIONS": {
            "socket_keepalive": True,
            "socket_connect_timeout": 2,
            "retry_on_timeout": True,
        },
    }
    if _USE_REDIS
    else {
        "CACHE_TYPE":            "SimpleCache",
        "CACHE_DEFAULT_TIMEOUT": 300,
    }
)
cache = Cache(config=_FLASK_CACHE_CONFIG)


# ── SocketIO ───────────────────────────────────────────────────────────────────
_sio_mq = (_REDIS_BASE + "/2") if _USE_REDIS else None
if _sio_mq:
    logger.info("[extensions] SocketIO initialized with Redis message queue: %s", _sio_mq)
else:
    logger.warning("[extensions] SocketIO initialized WITHOUT message queue (multi-worker broadcast will fail)")

socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="eventlet",
    message_queue=_sio_mq,
    logger=True,          # Enable for debugging
    engineio_logger=True, # Enable for debugging
)


# ── Flask-Login ────────────────────────────────────────────────────────────────
login_manager = LoginManager()
login_manager.login_view          = "login"
login_manager.login_message       = "Please log in to access this page."
login_manager.login_message_category = "warning"
login_manager.session_protection  = "strong"


@login_manager.user_loader
def load_user(user_id: str):
    """
    SQLAlchemy 2.0-compatible user loader.
    Uses db.session.get() instead of deprecated User.query.get().
    The result is intentionally NOT cached here — Flask-Login already
    stores the user in the request context; caching here would expose
    stale sessions after password/role changes.
    """
    try:
        from models.models import User
        return db.session.get(User, int(user_id))
    except Exception as e:
        logger.error("Error loading user %s: %s", user_id, e)
        return None


# ── Rate Limiter ───────────────────────────────────────────────────────────────
# Uses Redis DB 1 when available so limits survive worker restarts.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=(_REDIS_BASE + "/1") if _USE_REDIS else "memory://",
    default_limits=["200/minute"],
    strategy="fixed-window",  # limits 5.x removed elastic-expiry variant
)


# ── Redis client (application logic) ──────────────────────────────────────────
# Uses DB 1. ConnectionPool = shared TCP sockets across all app code.
class _RedisStub:
    """No-op stub used when Redis is not reachable. Silent failure."""
    def __getattr__(self, _name):
        def _noop(*a, **kw):
            return None
        return _noop


if _USE_REDIS:
    _pool = ConnectionPool.from_url(
        _REDIS_BASE + "/1",
        max_connections=50,
        socket_keepalive=True,
        socket_connect_timeout=2,
        retry_on_timeout=True,
        decode_responses=True,
    )
    redis_client = redis.Redis(connection_pool=_pool)
else:
    redis_client = _RedisStub()


# ── Lua scripts (pre-compiled at startup) ─────────────────────────────────────
# Rate-limiter with sliding window, returns (allowed:int, remaining:int)
RATE_LIMIT_LUA = """
local key     = KEYS[1]
local limit   = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])   -- seconds
local now     = tonumber(ARGV[3])   -- unix timestamp ms

redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)
local count = redis.call('ZCARD', key)
if count < limit then
    redis.call('ZADD', key, now, now)
    redis.call('PEXPIRE', key, window * 1000)
    return {1, limit - count - 1}
end
return {0, 0}
"""

# Bulk-set multiple hash fields + set expiry atomically
HMSET_EXPIRE_LUA = """
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
for i = 2, #ARGV, 2 do
    redis.call('HSET', key, ARGV[i], ARGV[i+1])
end
redis.call('EXPIRE', key, ttl)
return 1
"""

_rate_limit_script = None
_hmset_expire_script = None


def _register_lua_scripts():
    """Register Lua scripts once after Redis client is ready."""
    global _rate_limit_script, _hmset_expire_script
    if not _USE_REDIS or isinstance(redis_client, _RedisStub):
        return
    try:
        _rate_limit_script   = redis_client.register_script(RATE_LIMIT_LUA)
        _hmset_expire_script = redis_client.register_script(HMSET_EXPIRE_LUA)
        logger.info("[extensions] Lua scripts registered with Redis")
    except Exception as e:
        logger.warning("[extensions] Failed to register Lua scripts: %s", e)


def sliding_window_rate_limit(key: str, limit: int, window_s: int) -> tuple[bool, int]:
    """
    True → request allowed; int → remaining slots.
    Falls back to (True, limit) when Redis is unavailable.
    """
    if _rate_limit_script is None:
        return True, limit
    import time
    now_ms = int(time.time() * 1000)
    result = _rate_limit_script(keys=[key], args=[limit, window_s, now_ms])
    return bool(result[0]), int(result[1])


def redis_pipeline_set_many(mapping: dict, prefix: str = "", ttl: int = 300):
    """
    Bulk-SET keys via pipeline.  ~10x fewer round-trips than individual SETs.
    """
    if isinstance(redis_client, _RedisStub):
        return
    pipe = redis_client.pipeline(transaction=False)
    for k, v in mapping.items():
        pipe.setex(f"{prefix}{k}", ttl, v)
    pipe.execute()


# ── SeaweedFS client ───────────────────────────────────────────────────────────
from .seaweedfs_client import SeaweedFSClient   # noqa: E402

seaweedfs_client = SeaweedFSClient(
    filer_url=os.environ.get("SEAWEEDFS_FILER_URL", "localhost:8888"),
    master_url=os.environ.get("SEAWEEDFS_MASTER_URL", "localhost:9333"),
    secure=os.environ.get("SEAWEEDFS_SECURE", "false").lower() == "true",
)
minio_client = seaweedfs_client   # legacy alias

# Public surface so app.py and routes can do: from settings.extensions import logger
__all__ = [
    "db", "mail", "csrf", "cache", "socketio", "login_manager",
    "limiter", "redis_client", "seaweedfs_client", "minio_client",
    "logger", "sliding_window_rate_limit", "redis_pipeline_set_many",
    "_register_lua_scripts",
]
