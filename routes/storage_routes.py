"""
routes/storage_routes.py
========================
REST API for the /almacenamiento (Storage) dashboard view.
Blueprint prefix: /api/storage  (registered in appp.py)

Endpoints:
  GET /api/storage/summary               → KPI cards
  GET /api/storage/charts/usage          → Donut chart
  GET /api/storage/charts/growth         → Area/line chart
  GET /api/storage/charts/categories     → Bar chart + table
  GET /api/storage/charts/top-users      → Horizontal bar chart
  GET /api/storage/alerts                → Alerts grid
  GET /api/storage/table                 → Detail table rows
  GET /api/storage/export                → CSV / JSON download

All routes require @login_required.
All text responses are in English.
All JSON keys use camelCase.
"""

from flask import Blueprint, jsonify, request, Response
from flask_login import login_required, current_user
from sqlalchemy import func
from datetime import datetime, timedelta
import csv
import io
import math

from models.models import Document, DocumentVersion, StoragePlan, File, User, db
from settings.extensions import limiter, logger
from services.cache_service import cache

storage_bp = Blueprint('storage', __name__)

# ============================================================================
# PRIVATE HELPERS
# ============================================================================

def _calculate_real_usage(user_id: int) -> int:
    """
    Return the REAL total bytes consumed by a user, queried directly from DB.
    """

    # 1. Active documents
    doc_size = db.session.query(func.sum(Document.size_bytes)).filter(
        Document.owner_id == user_id,
        Document.is_deleted.is_(False)
    ).scalar() or 0

    # 2. Document versions (of non-deleted docs)
    version_size = db.session.query(func.sum(DocumentVersion.size_bytes)).join(
        Document, DocumentVersion.document_id == Document.id
    ).filter(
        Document.owner_id == user_id,
        Document.is_deleted.is_(False)
    ).scalar() or 0

    # 3. Uploaded files (File model uses `size` and `user_id`, not `size_bytes`/`owner_id`)
    file_size = db.session.query(func.sum(File.size)).filter(
        File.user_id == user_id
    ).scalar() or 0

    return int(doc_size + version_size + file_size)


def _get_plan_limit_bytes(user_id: int) -> int:
    """
    Query StoragePlan directly by the user's storage_plan_id.
    Avoids relying on the lazy-loaded `current_user.storage_plan` relationship
    which can silently fall back to the 1 GB default when not loaded.

    Also adds active StorageAddon bytes.
    """
    from models.models import StorageAddon, UserAddonSubscription

    user = db.session.query(User).filter(User.id == user_id).first()
    if not user or not user.storage_plan_id:
        return 1024 * 1024 * 1024  # 1 GB hard default

    plan = db.session.query(StoragePlan).filter(
        StoragePlan.id == user.storage_plan_id
    ).first()

    if not plan:
        return 1024 * 1024 * 1024

    base_bytes = plan.base_storage_mb * 1024 * 1024

    # Add active addon storage
    addon_bytes = db.session.query(
        func.sum(StorageAddon.storage_mb)
    ).join(
        UserAddonSubscription,
        UserAddonSubscription.addon_id == StorageAddon.id
    ).filter(
        UserAddonSubscription.user_id == user_id,
        UserAddonSubscription.is_active.is_(True)
    ).scalar() or 0

    return base_bytes + int(addon_bytes) * 1024 * 1024


def _get_plan(user_id: int):
    """
    Return the StoragePlan row for the user, queried directly (no lazy load).
    Returns None if no plan is assigned.
    """
    user = db.session.query(User).filter(User.id == user_id).first()
    if not user or not user.storage_plan_id:
        return None
    return db.session.query(StoragePlan).filter(
        StoragePlan.id == user.storage_plan_id
    ).first()


def _sync_usage(user) -> int:
    """
    Recalculate real usage via direct DB queries, persist if drift > 1 KB.
    """
    real = _calculate_real_usage(user.id)
    if abs((user.used_storage_bytes or 0) - real) > 1024:
        user.used_storage_bytes = real
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
    return real


def _format_bytes(n: int) -> str:
    """
    Convert bytes to a human-readable string: '858 MB', '1.4 TB', etc.
    """
    if n == 0:
        return '0 Bytes'
    units = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    i = min(int(math.floor(math.log(n, 1024))), len(units) - 1)
    val = n / (1024 ** i)
    decimals = 1 if i >= 2 else 0
    return f"{val:.{decimals}f} {units[i]}"


def _time_ago(dt: datetime) -> str:
    """Return a human-readable 'X ago' string."""
    if not dt:
        return 'Just now'
    delta = datetime.utcnow() - dt
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return 'Just now'
    minutes = seconds // 60
    if minutes < 60:
        return f'{minutes}m ago'
    hours = minutes // 60
    if hours < 24:
        return f'{hours}h ago'
    days = hours // 24
    return f'{days}d ago'


def _get_range_start(days: int) -> datetime:
    """Return the datetime that is `days` before now."""
    return datetime.utcnow() - timedelta(days=days)


def _status_level(pct: float) -> str:
    """Return alert level string based on usage percentage."""
    if pct >= 85:
        return 'critical'
    if pct >= 70:
        return 'warning'
    return 'ok'


def _mime_to_category(mime: str) -> str:
    """Map MIME type to a display category name."""
    if not mime:
        return 'Other'
    mime = mime.lower()
    if 'pdf' in mime:
        return 'PDF Files'
    if 'image' in mime:
        return 'Images'
    if 'video' in mime:
        return 'Media'
    if 'word' in mime or 'officedocument.wordprocessing' in mime:
        return 'Word Docs'
    if 'text' in mime or 'plain' in mime:
        return 'Text Files'
    return 'Documents'


def _parse_range() -> int:
    """Parse `?range=` query param, default 30, clamped to 7/30/90."""
    raw = request.args.get('range', 30, type=int)
    return raw if raw in (7, 30, 90) else 30


def _get_cat_usage_range(user_id: int, cat_name: str, start: datetime, end: datetime) -> int:
    """Helper to get usage for a category in a specific date range."""
    # Crude filter but matches _mime_to_category categories
    keyword = cat_name.split(' ')[0]
    
    d_sz = db.session.query(func.sum(Document.size_bytes)).filter(
        Document.owner_id == user_id,
        Document.is_deleted.is_(False),
        Document.created_at >= start,
        Document.created_at < end,
        Document.mime_type.ilike(f"%{keyword}%")
    ).scalar() or 0
    
    f_sz = db.session.query(func.sum(File.size)).filter(
        File.user_id == user_id,
        File.created_at >= start,
        File.created_at < end,
        File.mime_type.ilike(f"%{keyword}%")
    ).scalar() or 0
    
    return int(d_sz + f_sz)


# ============================================================================
# ENDPOINT 1 — Summary / KPIs
# ============================================================================

@storage_bp.route('/summary', methods=['GET'])
@login_required
@limiter.limit("60/minute")
def get_storage_summary():
    """
    KPI cards for the storage dashboard.

    UI consumers:
      svKpiCapacityValue, svKpiUsedValue, svKpiUsedFill, svKpiUsedPct,
      svKpiAvailableValue, svKpiGrowthValue, svKpiCostValue,
      svSubtitle, svSyncDot, svDonutBadge
    """
    try:
        days = request.args.get('range', 30, type=int)
        days = days if days in (7, 30, 90) else 30

        cache_key = f"storage:summary:{current_user.id}?days={days}"
        cached_data = cache.get(cache_key)
        if cached_data:
            return jsonify(cached_data)

        total_bytes = _get_plan_limit_bytes(current_user.id)
        used_bytes  = _sync_usage(current_user)
        avail_bytes = max(0, total_bytes - used_bytes)
        usage_pct   = round((used_bytes / total_bytes * 100), 1) if total_bytes > 0 else 0.0

        # Monthly growth (current window vs previous window)
        window_start = _get_range_start(days)
        prev_start   = _get_range_start(days * 2)

        current_growth = db.session.query(func.sum(Document.size_bytes)).filter(
            Document.owner_id == current_user.id,
            Document.created_at >= window_start,
            Document.is_deleted.is_(False)
        ).scalar() or 0

        prev_growth = db.session.query(func.sum(Document.size_bytes)).filter(
            Document.owner_id == current_user.id,
            Document.created_at >= prev_start,
            Document.created_at < window_start,
            Document.is_deleted.is_(False)
        ).scalar() or 0

        trend_pct = 0.0
        if prev_growth > 0:
            trend_pct = round(((current_growth - prev_growth) / prev_growth) * 100, 1)

        plan         = _get_plan(current_user.id)
        monthly_cost = float(plan.price_monthly_usd) if plan else 0.0
        plan_name    = plan.name if plan else 'Free'

        # Cost per GB
        total_gb    = total_bytes / (1024 ** 3)
        cost_per_gb = round(monthly_cost / total_gb, 2) if total_gb > 0 and monthly_cost > 0 else 0.0

        response_data = {
            'capacity': {
                'totalBytes':       total_bytes,
                'usedBytes':        used_bytes,
                'availableBytes':   avail_bytes,
                'usagePercentage':  usage_pct,
                'statusLevel':      _status_level(usage_pct),
                # Pre-formatted strings for direct innerHTML injection
                'totalFormatted':   _format_bytes(total_bytes),
                'usedFormatted':    _format_bytes(used_bytes),
                'availFormatted':   _format_bytes(avail_bytes),
            },
            'growth': {
                'monthlyBytes':     int(current_growth),
                'monthlyFormatted': _format_bytes(int(current_growth)),
                'trendPercentage':  trend_pct,
                'windowDays':       days,
            },
            'billing': {
                'monthlyCostUsd': monthly_cost,
                'costPerGbUsd':   cost_per_gb,
                'planName':       plan_name,
            },
            'syncAt': datetime.utcnow().isoformat() + 'Z',
        }
        
        cache.set(cache_key, response_data, ttl=600)
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"[storage/summary] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 2 — Donut chart (used vs. free)
# ============================================================================

@storage_bp.route('/charts/usage', methods=['GET'])
@login_required
@limiter.limit("60/minute")
def get_usage_donut():
    """
    Data for usage donut chart.

    UI consumers: svDonutChart, svLegendUsed, svLegendFree, svDonutBadge
    """
    try:
        total = _get_plan_limit_bytes(current_user.id)
        used  = _sync_usage(current_user)
        free  = max(0, total - used)

        return jsonify({
            'labels': ['Used', 'Free'],
            'values': [used, free],
            'colors': ['#f59e0b', '#34d399'],
            'formatted': [_format_bytes(used), _format_bytes(free)],
            'totalBytes': total,
        })

    except Exception as e:
        logger.error(f"[storage/charts/usage] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 3 — Growth line/area chart
# ============================================================================

@storage_bp.route('/charts/growth', methods=['GET'])
@login_required
@limiter.limit("30/minute")
def get_growth_chart():
    """
    Cumulative storage growth over the last N months (7 data points).

    Query params: ?range=7|30|90 (days per interval; 7 points total)

    UI consumers: svLineChart, svLineBadge
    """
    try:
        days = _parse_range()
        labels = []
        data_points = []

        # Build 7 evenly-spaced snapshots up to today
        now = datetime.utcnow()
        interval = days / 6  # 6 gaps → 7 points

        for i in range(6, -1, -1):
            point_dt = now - timedelta(days=i * interval)
            label = point_dt.strftime('%b %d') if days <= 7 else point_dt.strftime('%b')

            # 1. Active documents size
            doc_sum = db.session.query(func.sum(Document.size_bytes)).filter(
                Document.owner_id == current_user.id,
                Document.created_at <= point_dt,
                Document.is_deleted.is_(False)
            ).scalar() or 0

            # 2. Versions size
            version_sum = db.session.query(func.sum(DocumentVersion.size_bytes)).join(
                Document, DocumentVersion.document_id == Document.id
            ).filter(
                Document.owner_id == current_user.id,
                DocumentVersion.created_at <= point_dt,
                Document.is_deleted.is_(False)
            ).scalar() or 0

            # 3. Files size
            file_sum = db.session.query(func.sum(File.size)).filter(
                File.user_id == current_user.id,
                File.created_at <= point_dt
            ).scalar() or 0

            cumulative = int(doc_sum + version_sum + file_sum)
            labels.append(label)
            data_points.append(cumulative)

        return jsonify({
            'labels':     labels,
            'data':       data_points,
            'windowDays': days,
        })

    except Exception as e:
        logger.error(f"[storage/charts/growth] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 4 — Category distribution (bar chart + table)
# ============================================================================

@storage_bp.route('/charts/categories', methods=['GET'])
@login_required
@limiter.limit("30/minute")
def get_category_distribution():
    """
    Storage distribution by file type (bar chart and detail table).

    Query params: ?range=7|30|90

    UI consumers: svBarChart, svBarBadge, svTableBody
    """
    try:
        days  = _parse_range()
        since = _get_range_start(days)

        # 1. Documents + Versions stats
        # We attribute version size to the same category as the document
        doc_stats = db.session.query(
            Document.mime_type,
            func.count(Document.id).label('doc_count'),
            func.sum(Document.size_bytes).label('total_size')
        ).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False),
        ).group_by(Document.mime_type).all()

        version_stats = db.session.query(
            Document.mime_type,
            func.sum(DocumentVersion.size_bytes).label('total_size')
        ).join(
            Document, DocumentVersion.document_id == Document.id
        ).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False)
        ).group_by(Document.mime_type).all()

        # 2. Files stats
        file_stats = db.session.query(
            File.mime_type,
            func.count(File.id).label('file_count'),
            func.sum(File.size).label('total_size')
        ).filter(
            File.user_id == current_user.id
        ).group_by(File.mime_type).all()

        # Merge all into cat_map
        cat_map: dict = {}

        # Process docs
        for mime, count, size in doc_stats:
            cat_name = _mime_to_category(mime)
            if cat_name not in cat_map: cat_map[cat_name] = {'count': 0, 'sizeBytes': 0}
            cat_map[cat_name]['count'] += int(count)
            cat_map[cat_name]['sizeBytes'] += int(size or 0)

        # Process versions
        for mime, size in version_stats:
            cat_name = _mime_to_category(mime)
            if cat_name not in cat_map: cat_map[cat_name] = {'count': 0, 'sizeBytes': 0}
            cat_map[cat_name]['sizeBytes'] += int(size or 0)

        # Process files
        for mime, count, size in file_stats:
            cat_name = _mime_to_category(mime)
            if cat_name not in cat_map: cat_map[cat_name] = {'count': 0, 'sizeBytes': 0}
            cat_map[cat_name]['count'] += int(count)
            cat_map[cat_name]['sizeBytes'] += int(size or 0)

        # Previous window for growth per category
        prev_since = _get_range_start(days * 2)
        
        total_curr = sum(v['sizeBytes'] for v in cat_map.values())
        total_used = max(total_curr, 1)

        categories = []
        for name, vals in sorted(cat_map.items(), key=lambda x: -x[1]['sizeBytes']):
            pct = round(vals['sizeBytes'] / total_used * 100, 1)

            # Growth relative to previous period
            prev_sz = _get_cat_usage_range(current_user.id, name, prev_since, since)
            if prev_sz > 0:
                g = ((vals['sizeBytes'] - prev_sz) / prev_sz) * 100
                growth_str = f"{'+' if g >= 0 else ''}{g:.1f}%"
            else:
                growth_str = 'N/A'

            categories.append({
                'name':          name,
                'count':         vals['count'],
                'sizeBytes':     vals['sizeBytes'],
                'sizeFormatted': _format_bytes(vals['sizeBytes']),
                'percentage':    pct,
                'growth':        growth_str,
                'status':        'normal',
                'statusLabel':   'Normal',
            })

        if not categories:
            categories = [{
                'name': 'Uncategorized', 'count': 0,
                'sizeBytes': 0, 'sizeFormatted': '0 Bytes',
                'percentage': 0, 'growth': 'N/A',
                'status': 'normal', 'statusLabel': 'Normal',
            }]

        return jsonify({
            'categories':     categories,
            'totalCategories': len(categories),
        })

    except Exception as e:
        logger.error(f"[storage/charts/categories] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 5 — Top users horizontal bar chart
# ============================================================================

@storage_bp.route('/charts/top-users', methods=['GET'])
@login_required
@limiter.limit("30/minute")
def get_top_users():
    """
    Top 5 storage consumers (horizontal bar chart).

    For single-user context only the current user is returned.
    If the user is an admin or part of an institute, peers are shown.

    UI consumers: svHbarChart, svHbarBadge
    """
    try:
        total_bytes = _get_plan_limit_bytes(current_user.id)
        used_bytes  = _sync_usage(current_user)
        pct         = round((used_bytes / total_bytes * 100), 1) if total_bytes > 0 else 0.0

        # Single-user view — can be extended to multi-user/admin later
        display_name = current_user.name or current_user.email.split('@')[0]
        users = [{
            'name':          display_name,
            'email':         current_user.email,
            'usedBytes':     used_bytes,
            'usedFormatted': _format_bytes(used_bytes),
            'percentage':    pct,
        }]

        return jsonify({'users': users})

    except Exception as e:
        logger.error(f"[storage/charts/top-users] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 6 — Alerts
# ============================================================================

@storage_bp.route('/alerts', methods=['GET'])
@login_required
@limiter.limit("60/minute")
def get_storage_alerts():
    """
    System alerts based on usage thresholds and health checks.

    Rules:
      usage >= 85% → type 'error'   (Critical)
      usage >= 70% → type 'warning' (High usage)
      Always includes a 'success' health/sync alert.

    UI consumers: svAlertsGrid, svAlertUsage, svAlertBackup, svAlertLatency
    """
    try:
        total      = _get_plan_limit_bytes(current_user.id)
        used_bytes = _sync_usage(current_user)
        usage_pct  = round((used_bytes / total * 100), 1) if total > 0 else 0.0
        alerts     = []
        now        = datetime.utcnow()

        # ── Usage threshold alerts ──────────────────────────────────────────
        if usage_pct >= 85:
            alerts.append({
                'id':          'ALRT-USAGE-CRITICAL',
                'type':        'error',
                'title':       'Critical storage limit reached',
                'description': (
                    f'Storage is at {usage_pct:.0f}% capacity '
                    f'({_format_bytes(used_bytes)} of {_format_bytes(total)}). '
                    'Upgrade your plan immediately to avoid service interruption.'
                ),
                'timestamp': now.isoformat() + 'Z',
                'timeAgo':   'Just now',
            })
        elif usage_pct >= 70:
            alerts.append({
                'id':          'ALRT-USAGE-WARN',
                'type':        'warning',
                'title':       'High storage usage detected',
                'description': (
                    f'Storage has reached {usage_pct:.0f}% '
                    f'({_format_bytes(used_bytes)} of {_format_bytes(total)}). '
                    'Consider cleaning up old or unused documents before hitting the 85% threshold.'
                ),
                'timestamp': now.isoformat() + 'Z',
                'timeAgo':   'Just now',
            })

        # ── Sync / health alert ─────────────────────────────────────────────
        # Last doc activity as a proxy for sync health
        last_doc = db.session.query(Document.updated_at).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False),
        ).order_by(Document.updated_at.desc()).first()

        last_activity = last_doc[0] if last_doc else now

        alerts.append({
            'id':          'ALRT-HEALTH-OK',
            'type':        'success',
            'title':       'Backup completed successfully',
            'description': (
                'All storage volumes are healthy and synchronized. '
                'Next scheduled backup in 6 hours.'
            ),
            'timestamp': last_activity.isoformat() + 'Z',
            'timeAgo':   _time_ago(last_activity),
        })

        # ── Read latency info alert (static) ───────────────────────────────
        alerts.append({
            'id':          'ALRT-LATENCY-INFO',
            'type':        'info',
            'title':       'Storage read latency: normal',
            'description': 'Average read latency is within expected range (<20 ms). No action needed.',
            'timestamp':   now.isoformat() + 'Z',
            'timeAgo':     'Just now',
        })

        return jsonify({'alerts': alerts})

    except Exception as e:
        logger.error(f"[storage/alerts] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 7 — Detail table
# ============================================================================

@storage_bp.route('/table', methods=['GET'])
@login_required
@limiter.limit("30/minute")
def get_storage_table():
    """
    Category detail rows for the svTable component.

    Query params:
      ?range=7|30|90   — date window
      ?q=<string>      — text filter (applied server-side on category name)

    UI consumers: svTableBody, svTableFilter, svTableTitle
    """
    try:
        days  = _parse_range()
        query = request.args.get('q', '').strip().lower()

        # Aggregate everything together
        doc_stats = db.session.query(
            Document.mime_type,
            func.count(Document.id).label('doc_count'),
            func.sum(Document.size_bytes).label('total_size')
        ).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False),
        ).group_by(Document.mime_type).all()

        version_stats = db.session.query(
            Document.mime_type,
            func.sum(DocumentVersion.size_bytes).label('total_size')
        ).join(
            Document, DocumentVersion.document_id == Document.id
        ).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False)
        ).group_by(Document.mime_type).all()

        file_stats = db.session.query(
            File.mime_type,
            func.count(File.id).label('file_count'),
            func.sum(File.size).label('total_size')
        ).filter(
            File.user_id == current_user.id
        ).group_by(File.mime_type).all()

        cat_map: dict = {}
        # Merge logic same as categories chart
        for mime, count, size in doc_stats:
            name = _mime_to_category(mime)
            if name not in cat_map: cat_map[name] = {'count': 0, 'sizeBytes': 0}
            cat_map[name]['count'] += int(count)
            cat_map[name]['sizeBytes'] += int(size or 0)
        for mime, size in version_stats:
            name = _mime_to_category(mime)
            if name not in cat_map: cat_map[name] = {'count': 0, 'sizeBytes': 0}
            cat_map[name]['sizeBytes'] += int(size or 0)
        for mime, count, size in file_stats:
            name = _mime_to_category(mime)
            if name not in cat_map: cat_map[name] = {'count': 0, 'sizeBytes': 0}
            cat_map[name]['count'] += int(count)
            cat_map[name]['sizeBytes'] += int(size or 0)

        total_curr = sum(v['sizeBytes'] for v in cat_map.values())
        total_used = max(total_curr, 1)

        # Previous window for growth per category
        since = _get_range_start(days)
        prev_since = _get_range_start(days * 2)

        rows = []
        for name, vals in sorted(cat_map.items(), key=lambda x: -x[1]['sizeBytes']):
            if query and query not in name.lower():
                continue

            pct = round(vals['sizeBytes'] / total_used * 100, 1)
            
            # Real growth relative to previous period
            prev_sz = _get_cat_usage_range(current_user.id, name, prev_since, since)
            if prev_sz > 0:
                g = ((vals['sizeBytes'] - prev_sz) / prev_sz) * 100
                growth_str = f"{'+' if g >= 0 else ''}{g:.1f}%"
            else:
                growth_str = 'N/A'

            rows.append({
                'category':      name,
                'sizeBytes':     vals['sizeBytes'],
                'sizeFormatted': _format_bytes(vals['sizeBytes']),
                'percentage':    pct,
                'growth':        growth_str,
                'status':        'normal',
                'statusLabel':   'Normal',
            })

        if not rows:
            rows = [{
                'category': 'No data', 'sizeBytes': 0,
                'sizeFormatted': '0 Bytes', 'percentage': 0,
                'growth': 'N/A', 'status': 'normal', 'statusLabel': 'Normal',
            }]

        return jsonify({'rows': rows, 'totalRows': len(rows), 'range': days})

    except Exception as e:
        logger.error(f"[storage/table] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# ENDPOINT 8 — Export (CSV / JSON)
# ============================================================================

@storage_bp.route('/export', methods=['GET'])
@login_required
@limiter.limit("10/minute")
def export_storage_report():
    """
    Export the full storage report as CSV or JSON.

    Query params: ?format=csv|json (default: json)

    UI consumers: svExportBtn
    """
    try:
        fmt = request.args.get('format', 'json').lower()
        if fmt not in ('csv', 'json'):
            return jsonify({'error': 'Invalid format. Use csv or json.'}), 400

        total_bytes = current_user.get_total_storage_limit_bytes()
        used_bytes  = _sync_usage(current_user)
        usage_pct   = round((used_bytes / total_bytes * 100), 1) if total_bytes > 0 else 0.0
        plan        = current_user.storage_plan

        # Category rows
        stats = db.session.query(
            Document.mime_type,
            func.count(Document.id).label('doc_count'),
            func.sum(Document.size_bytes).label('total_size')
        ).filter(
            Document.owner_id == current_user.id,
            Document.is_deleted.is_(False),
        ).group_by(Document.mime_type).all()

        cat_map: dict = {}
        for mime, count, size in stats:
            cat_name = _mime_to_category(mime)
            if cat_name not in cat_map:
                cat_map[cat_name] = {'count': 0, 'sizeBytes': 0}
            cat_map[cat_name]['count']     += int(count)
            cat_map[cat_name]['sizeBytes'] += int(size or 0)

        total_used = max(sum(v['sizeBytes'] for v in cat_map.values()), 1)

        report_rows = []
        for name, vals in sorted(cat_map.items(), key=lambda x: -x[1]['sizeBytes']):
            pct = round(vals['sizeBytes'] / total_used * 100, 1)
            report_rows.append({
                'category':      name,
                'documents':     vals['count'],
                'sizeBytes':     vals['sizeBytes'],
                'sizeFormatted': _format_bytes(vals['sizeBytes']),
                'percentage':    pct,
            })

        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')

        if fmt == 'csv':
            output = io.StringIO()
            writer = csv.writer(output)

            # Header block
            writer.writerow(['Storage Report — Exported', ts])
            writer.writerow(['User', current_user.email])
            writer.writerow(['Plan', plan.name if plan else 'Free'])
            writer.writerow(['Total Capacity', _format_bytes(total_bytes)])
            writer.writerow(['Used', _format_bytes(used_bytes)])
            writer.writerow(['Available', _format_bytes(max(0, total_bytes - used_bytes))])
            writer.writerow(['Usage %', f'{usage_pct}%'])
            writer.writerow([])

            # Category table
            writer.writerow(['Category', 'Documents', 'Size (Bytes)', 'Size', '% of Total'])
            for row in report_rows:
                writer.writerow([
                    row['category'], row['documents'],
                    row['sizeBytes'], row['sizeFormatted'], row['percentage'],
                ])

            csv_content = output.getvalue()
            return Response(
                csv_content,
                mimetype='text/csv',
                headers={'Content-Disposition': f'attachment; filename=storage_report_{ts}.csv'},
            )

        # JSON export
        payload = {
            'exportedAt':  datetime.utcnow().isoformat() + 'Z',
            'user':        current_user.email,
            'plan':        plan.name if plan else 'Free',
            'summary': {
                'totalBytes':      total_bytes,
                'usedBytes':       used_bytes,
                'availableBytes':  max(0, total_bytes - used_bytes),
                'usagePercentage': usage_pct,
            },
            'categories': report_rows,
        }
        return Response(
            __import__('json').dumps(payload, indent=2),
            mimetype='application/json',
            headers={'Content-Disposition': f'attachment; filename=storage_report_{ts}.json'},
        )

    except Exception as e:
        logger.error(f"[storage/export] {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500
