import json
import logging
import redis
import time
import fnmatch
from threading import Lock

import os

# Configure standard logger
logger = logging.getLogger(__name__)

# Cache Service Configuration
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
SOCKET_CONNECT_TIMEOUT = 2
SOCKET_TIMEOUT = 3
MAX_CONNECTIONS = 20

# Metric key constants
_KEY_HITS      = 'metrics:cache:hits'
_KEY_MISSES    = 'metrics:cache:misses'
_KEY_TIME_MS   = 'metrics:cache:time_total_ms'
_KEY_REQ_COUNT = 'metrics:cache:req_count'
_KEY_HISTORY   = 'metrics:cache:history'   # LPUSH list of JSON snapshots

# Global Redis client
try:
    pool = redis.ConnectionPool.from_url(
        REDIS_URL,
        max_connections=MAX_CONNECTIONS,
        socket_connect_timeout=SOCKET_CONNECT_TIMEOUT,
        socket_timeout=SOCKET_TIMEOUT,
        decode_responses=True
    )
    redis_client = redis.Redis(connection_pool=pool)
except Exception as e:
    logger.error(f"Failed to initialize Redis pool: {e}")
    redis_client = None


class SimpleMemoryCache:
    """Fallback in-memory cache for when Redis is unavailable."""
    def __init__(self):
        self._data = {}
        self._lock = Lock()
        self._metrics = {
            _KEY_HITS: 0,
            _KEY_MISSES: 0,
            _KEY_TIME_MS: 0.0,
            _KEY_REQ_COUNT: 0
        }

    def get(self, key):
        with self._lock:
            self._metrics[_KEY_REQ_COUNT] += 1
            entry = self._data.get(key)
            if entry:
                val, expires = entry
                if expires is None or expires > time.time():
                    self._metrics[_KEY_HITS] += 1
                    return val
                else:
                    del self._data[key]
            
            self._metrics[_KEY_MISSES] += 1
            return None

    def set(self, key, value, ttl=None):
        expires = (time.time() + ttl) if ttl else None
        with self._lock:
            self._data[key] = (value, expires)
        return True

    def delete(self, key):
        with self._lock:
            return self._data.pop(key, None) is not None

    def invalidate(self, pattern):
        with self._lock:
            keys_to_del = [k for k in self._data.keys() if fnmatch.fnmatch(k, pattern)]
            for k in keys_to_del:
                self._data.pop(k, None)
            return len(keys_to_del)


class CacheService:
    _fallback = SimpleMemoryCache()
    _last_redis_check = 0
    _redis_down = False

    @staticmethod
    def _check_redis():
        """Internal check to see if we should even try Redis."""
        now = time.time()
        if CacheService._redis_down and (now - CacheService._last_redis_check < 60):
            return False
        
        CacheService._last_redis_check = now
        if not redis_client:
            CacheService._redis_down = True
            return False
            
        try:
            redis_client.ping()
            if CacheService._redis_down:
                logger.info("Redis connection restored. Resuming normal cache operations.")
            CacheService._redis_down = False
            return True
        except redis.exceptions.RedisError:
            if not CacheService._redis_down:
                logger.warning("Redis unavailable. Switching to in-memory fallback (non-persistent).")
            CacheService._redis_down = True
            return False

    @staticmethod
    def is_cache_available():
        if CacheService._check_redis():
            try:
                start = time.perf_counter()
                result = redis_client.ping()
                latency = int((time.perf_counter() - start) * 1000)
                return result, latency
            except Exception:
                pass
        return False, None

    @staticmethod
    def get(key):
        if CacheService._check_redis():
            try:
                t0 = time.perf_counter()
                data = redis_client.get(key)
                elapsed_ms = (time.perf_counter() - t0) * 1000

                if data is not None:
                    try:
                        result = json.loads(data)
                        pipe = redis_client.pipeline(transaction=False)
                        pipe.incr(_KEY_HITS)
                        pipe.incrbyfloat(_KEY_TIME_MS, elapsed_ms)
                        pipe.incr(_KEY_REQ_COUNT)
                        pipe.execute()
                        return result
                    except json.JSONDecodeError:
                        redis_client.delete(key)
                        return None
                else:
                    pipe = redis_client.pipeline(transaction=False)
                    pipe.incr(_KEY_MISSES)
                    pipe.incr(_KEY_REQ_COUNT)
                    pipe.execute()
                    return None
            except redis.exceptions.RedisError:
                pass
        
        # Fallback
        return CacheService._fallback.get(key)

    @staticmethod
    def set(key, value, ttl=300):
        if CacheService._check_redis():
            try:
                serialized = json.dumps(value)
                return redis_client.setex(key, ttl, serialized)
            except redis.exceptions.RedisError:
                pass
        
        # Fallback
        return CacheService._fallback.set(key, value, ttl)

    @staticmethod
    def delete(key):
        if CacheService._check_redis():
            try:
                return redis_client.delete(key) > 0
            except redis.exceptions.RedisError:
                pass
        return CacheService._fallback.delete(key)

    @staticmethod
    def invalidate(pattern):
        if CacheService._check_redis():
            try:
                cursor = '0'
                to_delete = []
                while cursor != 0:
                    cursor, keys = redis_client.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        to_delete.extend(keys)
                if to_delete:
                    redis_client.delete(*to_delete)
                return True
            except redis.exceptions.RedisError:
                pass
        return CacheService._fallback.invalidate(pattern)

    @staticmethod
    def get_metrics():
        is_up, latency_ms = CacheService.is_cache_available()

        if is_up:
            try:
                pipe = redis_client.pipeline(transaction=False)
                pipe.get(_KEY_HITS)
                pipe.get(_KEY_MISSES)
                pipe.get(_KEY_TIME_MS)
                pipe.get(_KEY_REQ_COUNT)
                pipe.lrange(_KEY_HISTORY, 0, 29)
                results = pipe.execute()

                hits = int(results[0] or 0)
                misses = int(results[1] or 0)
                time_total = float(results[2] or 0)
                req_count = int(results[3] or 0)
                history_raw = results[4] or []
                history = []
                for item in history_raw:
                    try:
                        history.append(json.loads(item))
                    except:
                        continue
                history.reverse()

                total = hits + misses
                hit_ratio = round((hits / total) * 100, 1) if total > 0 else 0
                avg_cached_ms = round(time_total / req_count, 2) if req_count > 0 else 0

                # Snapshot logic
                now_ts = int(time.time())
                if not history or (now_ts - history[-1].get('t', 0) > 60):
                    snap = json.dumps({'t': now_ts, 'hr': hit_ratio, 'h': hits, 'm': misses})
                    redis_client.lpush(_KEY_HISTORY, snap)
                    redis_client.ltrim(_KEY_HISTORY, 0, 29)
                    history.append(json.loads(snap))

                return {
                    'systemStatus': 'up',
                    'hitRatio': hit_ratio,
                    'totalHits': hits,
                    'totalMisses': misses,
                    'latencyCachedMs': avg_cached_ms,
                    'latencyUncachedEstMs': 250,
                    'dbQueriesAvoided': hits,
                    'pingLatencyMs': latency_ms,
                    'recommendation': 'Redis is active and serving requests.',
                    'history': history
                }
            except Exception:
                pass

        # Fallback metrics
        m = CacheService._fallback._metrics
        total = m[_KEY_HITS] + m[_KEY_MISSES]
        hit_ratio = round((m[_KEY_HITS] / total) * 100, 1) if total > 0 else 0
        
        return {
            'systemStatus': 'fallback',
            'hitRatio': hit_ratio,
            'totalHits': m[_KEY_HITS],
            'totalMisses': m[_KEY_MISSES],
            'latencyCachedMs': 0.1,
            'latencyUncachedEstMs': 250,
            'dbQueriesAvoided': m[_KEY_HITS],
            'pingLatencyMs': -1,
            'recommendation': 'Using in-memory fallback (Redis down).',
            'history': []
        }


# Global singleton
cache = CacheService()
