"""
gunicorn.conf.py — PhD-grade Gunicorn configuration
=====================================================
Worker model choice: eventlet
  • Matches the eventlet.monkey_patch() already in app.py
  • Required by Flask-SocketIO (async_mode='eventlet')
  • One process handles thousands of concurrent connections via green threads
  • CPU-bound tasks (BLOOMZ inference) should be offloaded to Celery/RQ workers
    — do NOT run them in this Gunicorn process.

Tuning formula for eventlet workers:
  workers = (2 × CPU_cores) + 1  — classic formula for I/O-bound workloads
  With eventlet each worker is single-threaded but highly concurrent.

For a 2-vCPU container: workers=5 → 5 × 1000 green threads = 5 000 concurrent requests.
"""
# ── Early eventlet monkey patch: MUST be first — before any other import ────────────
import eventlet
eventlet.monkey_patch()
# ──────────────────────────────────────────────────────────────────────────────

import os
import multiprocessing

# ── Binding ───────────────────────────────────────────────────────────────────
bind             = f"0.0.0.0:{os.environ.get('PORT', '5002')}"
backlog          = 2048          # max pending connections before OS drops them

# ── Workers ───────────────────────────────────────────────────────────────────
worker_class     = "eventlet"    # MUST match eventlet.monkey_patch() in app.py
workers          = int(os.environ.get("WEB_CONCURRENCY",
                        (2 * multiprocessing.cpu_count()) + 1))
worker_connections = 1000        # green threads per worker (eventlet)

# ── Timeouts ──────────────────────────────────────────────────────────────────
# timeout: worker killed if it doesn't respond within N seconds.
# With eventlet, most requests finish in ms; 60 s covers slow AI calls.
timeout          = 60
graceful_timeout = 30            # seconds for in-flight requests to finish on SIGTERM
keepalive        = 5             # seconds to keep idle HTTP/1.1 connections open

# ── Process management ────────────────────────────────────────────────────────
preload_app      = True          # load app code BEFORE forking workers
                                 # → shared memory for read-only data (e.g. config)
                                 # → faster cold-start per worker fork
max_requests     = 1000          # restart worker after N requests (prevents leaks)
max_requests_jitter = 100        # random jitter so workers don't all restart at once

# ── Logging ───────────────────────────────────────────────────────────────────
loglevel         = os.environ.get("GUNICORN_LOG_LEVEL", "warning")
accesslog        = "-"           # stdout → collected by Docker logging driver
errorlog         = "-"           # stderr
access_log_format = (
    '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'
)
capture_output   = True

# ── Security ─────────────────────────────────────────────────────────────────
# Strip X-Forwarded-For spoofing: trust proxy headers only from trusted IPs.
# Adjust if you put Nginx/Caddy in front.
forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")
proxy_allow_ips     = forwarded_allow_ips
proxy_protocol      = False

# ── Server hooks ─────────────────────────────────────────────────────────────
def on_starting(server):
    server.log.info("Gunicorn starting — workers=%d class=%s",
                    workers, worker_class)


def post_fork(server, worker):
    """Register Redis Lua scripts after fork (each worker needs its own connection)."""
    try:
        from settings.extensions import _register_lua_scripts
        _register_lua_scripts()
    except Exception as e:
        server.log.warning("Lua script registration failed: %s", e)


def worker_abort(worker):
    """Log when a worker is killed (timeout, OOM, etc.)."""
    worker.log.warning("Worker aborted (PID %s) — check for slow routes or memory leaks",
                       worker.pid)
