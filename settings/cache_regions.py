"""
settings/cache_regions.py — Dogpile.cache ORM-level transparent caching
=========================================================================
Why dogpile.cache instead of (or alongside) Flask-Caching?
 • Flask-Caching operates at the HTTP-route level (full response).
 • dogpile.cache operates at the *function/query* level — you cache the
   result of a DB call regardless of which route triggered it.
 • Built-in "dog-pile" / thundering-herd prevention: only ONE caller
   regenerates an expired value; others serve stale until it's done.

Usage in routes / services
─────────────────────────────────────────────────────────────────────────
    from settings.cache_regions import query_region

    # Cache for 5 minutes; key derived from all arguments automatically
    @query_region.cache_on_arguments(expiration_time=300)
    def get_user_documents(user_id: int):
        return Document.query.filter_by(owner_id=user_id).all()

    # Invalidate when a document is created/updated/deleted
    get_user_documents.invalidate(current_user.id)

    # Cache an arbitrary value
    with query_region.get_or_create("some:key") as value:
        if value is NO_VALUE:
            value = expensive_db_call()
"""
import os
import logging

logger = logging.getLogger(__name__)

_REDIS_BASE = os.environ.get("REDIS_URL", "redis://localhost:6379")
_DOGPILE_URL = _REDIS_BASE + "/3"   # DB 3 — isolated from Flask-Caching (DB 0)

try:
    from dogpile.cache import make_region
    from dogpile.cache.api import NO_VALUE  # noqa: F401 — re-exported for callers

    # ── Primary region: Redis-backed, 5-minute default TTL ────────────────────
    query_region = make_region(
        name="query_region",
        function_key_generator=None,   # use default (module:function:args)
    ).configure(
        "dogpile.cache.redis",
        expiration_time=300,           # seconds; override per call
        arguments={
            "url":              _DOGPILE_URL,
            "distributed_lock": True,  # prevents thundering herd
            "lock_timeout":     30,    # seconds before lock forcibly released
            "socket_keepalive": True,
            "socket_connect_timeout": 2,
            "retry_on_timeout": True,
            # Use msgpack for 30-50% smaller payloads vs pickle
            # (requires dogpile.cache >= 1.1 + msgpack installed)
            # "serializer": "dogpile.cache.serializer.msgpack",
            "redis_expiration_time": 310,  # slightly > expiration_time
        },
    )

    # ── Short-lived region: 60 s — for hot paths (folder listing, doc list) ──
    short_region = make_region(name="short_region").configure(
        "dogpile.cache.redis",
        expiration_time=60,
        arguments={
            "url":              _DOGPILE_URL,
            "distributed_lock": True,
            "lock_timeout":     10,
            "redis_expiration_time": 65,
        },
    )

    # ── Session/user region: 30 min — for user profile data ──────────────────
    user_region = make_region(name="user_region").configure(
        "dogpile.cache.redis",
        expiration_time=1800,
        arguments={
            "url":              _DOGPILE_URL,
            "distributed_lock": True,
            "lock_timeout":     60,
            "redis_expiration_time": 1810,
        },
    )

    _DOGPILE_AVAILABLE = True
    logger.info("[cache_regions] dogpile.cache regions configured → %s", _DOGPILE_URL)

except ImportError:
    logger.warning(
        "[cache_regions] dogpile.cache not installed — "
        "ORM-level caching disabled. Run: pip install dogpile.cache"
    )
    _DOGPILE_AVAILABLE = False

    # ── Null-object fallback so imports never fail ────────────────────────────
    class _NullRegion:
        """No-op region: every decorated function runs uncached."""
        def cache_on_arguments(self, *a, **kw):
            def decorator(fn):
                fn.invalidate = lambda *a, **kw: None
                fn.invalidate_multi = lambda *a, **kw: None
                return fn
            return decorator

        def get_or_create(self, key, creator, *a, **kw):
            return creator()

        def delete(self, key):
            pass

        def delete_multi(self, keys):
            pass

    _null = _NullRegion()
    query_region = _null
    short_region = _null
    user_region  = _null
    NO_VALUE     = object()   # sentinel


# ── Convenience helpers ────────────────────────────────────────────────────────

def invalidate_user_cache(user_id: int):
    """Call after any write that modifies user-owned data."""
    if not _DOGPILE_AVAILABLE:
        return
    # Each cached function exposes .invalidate(*original_args)
    # Callers should call fn.invalidate(user_id) directly on the
    # decorated function; this helper is for cross-cutting invalidation.
    pass


def make_cache_key(*parts) -> str:
    """Build a consistent Redis key from arbitrary parts."""
    return ":".join(str(p) for p in parts)
