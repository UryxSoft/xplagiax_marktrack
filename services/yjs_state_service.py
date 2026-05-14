"""
services/yjs_state_service.py
Yjs CRDT State persistence service.

Architecture:
  - Layer 1 (hot): Redis — raw Yjs binary state, TTL 2h, key: yjs:state:{doc_id}
  - Layer 2 (cold): MySQL BLOB — Document.yjs_state, flushed on explicit persist()

This service is compatible with eventlet (no threads), uses the existing
redis_client from settings.extensions and the CacheService pattern from cache_service.py.

Usage:
    state_b64 = YjsStateService.get_state(doc_id)     # → base64 str or None
    YjsStateService.apply_update(doc_id, update_b64)  # merge update into cached state
    YjsStateService.persist(doc_id)                   # flush Redis → MySQL
"""
from __future__ import annotations

import base64
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Redis TTL for Yjs state cache (2 hours — documents are usually closed before this)
_YJS_TTL_SECONDS = 7200

# Minimum update count before a background flush to MySQL is triggered
_FLUSH_THRESHOLD = 50

# Redis key patterns
_KEY_STATE   = 'yjs:state:{doc_id}'       # binary state (base64 encoded)
_KEY_DIRTY   = 'yjs:dirty:{doc_id}'       # update counter since last MySQL flush
_KEY_LOCK    = 'yjs:lock:{doc_id}'        # distributed lock for flush


class YjsStateService:
    """
    Manages Yjs CRDT state for collaborative documents.

    State is kept in Redis as a base64-encoded Yjs binary update vector.
    MySQL (Document.yjs_state) acts as the authoritative cold store and
    is updated via explicit persist() calls.

    NOTE: This implementation does NOT do Yjs CRDT merging on the server side
    (that requires a Yjs Python port which doesn't exist). Instead it stores
    the LATEST full state snapshot (as sent by the client after each local merge).
    The client is responsible for merging incoming updates and sending the
    resulting full state on a periodic basis (every 60s or on beforeunload).
    """

    # ── Read ──────────────────────────────────────────────────────────────────

    @staticmethod
    def get_state(doc_id: int) -> str | None:
        """
        Get the current Yjs state by combining MySQL base + Redis pending updates.
        Returns base64-encoded binary state string.
        """
        try:
            from settings.extensions import redis_client
            from models.models import Document
            
            # 1. Load base from DB
            doc = Document.query.get(doc_id)
            base_bytes = doc.yjs_state if doc and doc.yjs_state else b""
            
            # 2. Load pending updates from Redis list
            if redis_client:
                redis_key = _KEY_STATE.format(doc_id=doc_id)
                # We store updates in a list for CRDT concatenation
                updates_b64 = redis_client.lrange(redis_key, 0, -1)
                
                if updates_b64:
                    # Concatenate base + all updates
                    # Yjs allows binary concatenation of updates
                    combined = base_bytes + b"".join([base64.b64decode(u) for u in updates_b64])
                    return base64.b64encode(combined).decode('utf-8')
            
            return base64.b64encode(base_bytes).decode('utf-8') if base_bytes else None
        except Exception as exc:
            logger.error(f'[YjsState] get_state failed for doc={doc_id}: {exc}')
            return None

    @staticmethod
    def _load_from_db(doc_id: int) -> str | None:
        """Load binary state from Document.yjs_state, return as base64 string."""
        try:
            from models.models import Document
            doc = Document.query.get(doc_id)
            if doc and doc.yjs_state:
                state_b64 = base64.b64encode(doc.yjs_state).decode('utf-8')
                # Warm the Redis cache
                YjsStateService._cache_state(doc_id, state_b64)
                return state_b64
        except Exception as exc:
            logger.debug(f'[YjsState] DB load failed for doc={doc_id}: {exc}')
        return None

    # ── Write ─────────────────────────────────────────────────────────────────

    @staticmethod
    def apply_update(doc_id: int, update_b64: str) -> bool:
        """
        Append a Yjs binary update (delta) to the Redis list for this document.
        Triggers a MySQL flush when the threshold of updates is reached.
        """
        try:
            from settings.extensions import redis_client
            if redis_client:
                # 1. Append update to Redis list
                key = _KEY_STATE.format(doc_id=doc_id)
                redis_client.rpush(key, update_b64)
                redis_client.expire(key, _YJS_TTL_SECONDS)

                # 2. Increment dirty counter
                dirty_key = _KEY_DIRTY.format(doc_id=doc_id)
                count = redis_client.incr(dirty_key)
                redis_client.expire(dirty_key, _YJS_TTL_SECONDS)

                # 3. Background flush when threshold reached
                if count and int(count) >= _FLUSH_THRESHOLD:
                    YjsStateService.persist(doc_id)
                return True
        except Exception as exc:
            logger.error(f'[YjsState] apply_update failed for doc={doc_id}: {exc}')
        return False

    @staticmethod
    def save_full_state(doc_id: int, state_b64: str) -> bool:
        """
        Save a complete Yjs state snapshot (sent by client on periodic save or beforeunload).
        This always flushes to MySQL as well as caching in Redis.
        """
        try:
            YjsStateService._cache_state(doc_id, state_b64)
            return YjsStateService.persist(doc_id)
        except Exception as exc:
            logger.debug(f'[YjsState] save_full_state failed for doc={doc_id}: {exc}')
        return False

    # ── Persistence ───────────────────────────────────────────────────────────

    @staticmethod
    def persist(doc_id: int) -> bool:
        """
        Consolidate Redis updates into the MySQL BLOB and clear Redis list.
        """
        try:
            from settings.extensions import redis_client, db
            from models.models import Document
            
            lock_key = _KEY_LOCK.format(doc_id=doc_id)
            if redis_client:
                acquired = redis_client.set(lock_key, '1', nx=True, ex=10)
                if not acquired: return False

            # 1. Get the combined state (MySQL + Redis)
            state_b64 = YjsStateService.get_state(doc_id)
            if not state_b64:
                if redis_client: redis_client.delete(lock_key)
                return False

            # 2. Save to MySQL
            doc = Document.query.get(doc_id)
            if doc:
                doc.yjs_state = base64.b64decode(state_b64)
                doc.updated_at = datetime.utcnow()
                db.session.commit()
                
                # 3. SUCCESS: Clear Redis and dirty counter
                if redis_client:
                    redis_client.delete(_KEY_STATE.format(doc_id=doc_id))
                    redis_client.delete(_KEY_DIRTY.format(doc_id=doc_id))
                    redis_client.delete(lock_key)
                
                logger.info(f'[YjsState] Persisted and cleared Redis for doc={doc_id}')
                return True
            
            if redis_client: redis_client.delete(lock_key)
            return False
        except Exception as exc:
            logger.error(f'[YjsState] persist failed for doc={doc_id}: {exc}')
            return False

    # ── Cleanup ───────────────────────────────────────────────────────────────

    @staticmethod
    def evict(doc_id: int) -> None:
        """Remove Yjs state from Redis cache (call when document is deleted)."""
        try:
            from settings.extensions import redis_client
            if redis_client:
                redis_client.delete(
                    _KEY_STATE.format(doc_id=doc_id),
                    _KEY_DIRTY.format(doc_id=doc_id),
                )
        except Exception as exc:
            logger.debug(f'[YjsState] evict failed for doc={doc_id}: {exc}')

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _cache_state(doc_id: int, state_b64: str) -> None:
        """Write state to Redis with TTL."""
        from settings.extensions import redis_client
        if redis_client:
            key = _KEY_STATE.format(doc_id=doc_id)
            redis_client.setex(key, _YJS_TTL_SECONDS, state_b64)
