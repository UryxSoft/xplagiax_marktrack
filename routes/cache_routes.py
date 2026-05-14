from flask import Blueprint, jsonify
from services.cache_service import cache
from datetime import datetime

cache_bp = Blueprint('cache', __name__)


@cache_bp.route('/api/cache/status', methods=['GET'])
def cache_status():
    is_available, latency = cache.is_cache_available()
    return jsonify({
        "status": "up" if is_available else "down",
        "latency_ms": latency if latency is not None else -1,
        "last_checked": datetime.utcnow().isoformat() + "Z"
    })


@cache_bp.route('/api/cache/metrics', methods=['GET'])
def cache_metrics():
    """
    Returns aggregated performance metrics for the Performance Insights Modal.
    Safe to call even when Redis is unavailable.
    """
    metrics = cache.get_metrics()
    return jsonify(metrics)

