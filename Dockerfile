# =============================================================================
# Dockerfile — xplagiax / marktrack  (multi-stage, PhD-grade)
# =============================================================================
# Stage 1 "builder": compiles mysqlclient C extension + installs all Python
#   deps into an isolated prefix (/install).  Build tools are NOT copied to
#   the final image → smaller attack surface, smaller layer.
#
# Stage 2 "runtime": copies only /install + app code; runs as non-root user.
#
# Build:
#   docker build -t marktrack:latest .
#
# Run (development override):
#   docker run --env-file .env -p 5000:5000 marktrack:latest
# =============================================================================

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS builder

# System deps needed to compile mysqlclient (C extension) + WeasyPrint (Pango/Cairo)
RUN apt-get update && apt-get install -y --no-install-recommends \
        # mysqlclient build deps
        pkg-config \
        default-libmysqlclient-dev \
        gcc \
        # WeasyPrint runtime (also needed at compile time for cffi)
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
        libgdk-pixbuf2.0-0 \
        libffi-dev \
        # python-magic
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install all Python deps into /install (isolated from system Python)
COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip wheel && \
    pip install \
        --prefix=/install \
        --no-cache-dir \
        # Force C extension build of mysqlclient (no pure-Python fallback)
        --no-binary mysqlclient \
        -r /tmp/requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runtime

LABEL maintainer="xplagiax-team"
LABEL org.opencontainers.image.description="marktrack Flask app — production runtime"

# Runtime-only system libraries (no build tools, no headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
        # mysqlclient C extension runtime
        default-libmysqlclient-dev \
        # WeasyPrint rendering
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
        libgdk-pixbuf2.0-0 \
        # python-magic
        libmagic1 \
        # curl for healthcheck
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy compiled Python packages from builder
COPY --from=builder /install /usr/local

# ── Security: non-root user ────────────────────────────────────────────────────
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --no-create-home --shell /bin/false appuser

# App workdir
WORKDIR /app

# Copy application code (respects .dockerignore)
COPY --chown=appuser:appgroup . /app

# Create uploads directory with correct ownership
RUN mkdir -p /app/uploads && chown appuser:appgroup /app/uploads

# Switch to non-root
USER appuser

# Expose Gunicorn port
EXPOSE 5002

# ── Healthcheck ────────────────────────────────────────────────────────────────
# Checks the /health endpoint every 30 s; 3 consecutive failures → unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5002/health || exit 1

# ── Entrypoint ─────────────────────────────────────────────────────────────────
# gunicorn.conf.py contains all tuning (workers, threads, keep-alive, etc.)
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
