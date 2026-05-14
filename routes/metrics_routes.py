from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from models.models import EssaySubmissionMetrics, WorkspaceInvitation, Document, db
from settings.extensions import csrf
from services.cache_service import cache
import json
import traceback

metrics_bp = Blueprint('metrics_bp', __name__)
csrf.exempt(metrics_bp)


# ── Helper ──────────────────────────────────────────────────────────────────
def _resolve_invitation_by_token(invite_token: str):
    """Return a WorkspaceInvitation if the token is valid, else None."""
    if not invite_token:
        return None
    return WorkspaceInvitation.query.filter_by(token=invite_token).first()


@metrics_bp.route('/api/save-essay-metrics', methods=['POST'])
def save_essay_metrics():
    """
    Guarda las métricas de digitación y la firma digital.

    Validación: el request DEBE incluir 'invite_token' (el mismo token de URL
    de la invitación). El invitation_id se resuelve internamente a partir del
    token, evitando escrituras arbitrarias a la DB.

    Body JSON:
        invite_token   (str)  — token de la invitación (REQUERIDO)
        workspace_id   (int)  — opcional, se infiere de la invitación
        document_id    (int)  — opcional
        metrics        (dict) — contadores de escritura
        final_text     (str)  — texto plano del documento completo
        quill_delta    (dict) — delta Quill serializado
        signature_data (str)  — imagen Base64 de la firma
        is_final       (bool) — True cuando es la entrega final
    """
    try:
        data = request.json
        with open("/tmp/metrics_debug.log", "a") as f:
            f.write(f"RECEIVED: {json.dumps(data)}\n")
        
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        # ── Validar por token de invitación (FIX #3 seguridad) ────────────
        invite_token = data.get('invite_token') or data.get('invitation_token')

        # Fallback: intentar extraer el token de la cabecera Referer
        if not invite_token:
            referer = request.referrer or ''
            # URL pattern: /invite/<token>/...
            parts = referer.split('/invite/')
            if len(parts) > 1:
                invite_token = parts[1].split('/')[0]

        invitation = _resolve_invitation_by_token(invite_token)

        if not invitation:
            # Sin token válido → rechazar
            current_app.logger.warning(
                f'[metrics] Rejected unauthenticated call. invite_token={invite_token!r}'
            )
            return jsonify({'success': False, 'error': 'Invalid or missing invitation token'}), 403

        # ── Access Validation (Redis + DB Fallback) ───────────────────────
        workspace_id = invitation.workspace_id
        is_final = data.get('is_final')

        # Final submissions (is_final=True) bypass the deadline/closed check.
        # The invitation token is already valid proof of identity and the student
        # is entitled to have their signature + last metrics persisted even if the
        # session window closed a few seconds before they clicked "Submit".
        if not is_final:
            cache_key = f"ws:access:{workspace_id}"
            ws_access = cache.get(cache_key)

            from datetime import datetime, timezone
            now_dt = datetime.utcnow()

            if not ws_access:
                ws = invitation.workspace
                invs = ws.invitations.all()
                ws_access = {
                    'global_closed': ws.is_closed,
                    'global_deadline': ws.deadline.timestamp() if ws.deadline else None,
                    'extensions': {
                        str(inv.id): inv.extended_deadline.timestamp() if inv.extended_deadline else None
                        for inv in invs
                    }
                }
                cache.set(cache_key, ws_access, ttl=3600)

            inv_id_str = str(invitation.id)
            ext_timestamp = ws_access.get('extensions', {}).get(inv_id_str)
            has_access = False

            if ext_timestamp:
                has_access = now_dt.timestamp() <= ext_timestamp
            else:
                if not ws_access.get('global_closed') and ws_access.get('global_deadline'):
                    has_access = now_dt.timestamp() <= ws_access['global_deadline']

            if not has_access:
                return jsonify({'success': False, 'error': 'SESSION_CLOSED', 'message': 'La sesión ha finalizado o ha sido cerrada por el profesor.'}), 403
        # ──────────────────────────────────────────────────────────────────

        invitation_id = invitation.id
        workspace_id  = invitation.workspace_id
        document_id   = data.get('document_id') or invitation.document_id

        metrics       = data.get('metrics', {})
        quill_delta   = data.get('quill_delta')
        signature_data= data.get('signature_data')

        # ── Safe Getter ───────────────────────────────────────────────────
        def safe_get(d, key, default=0):
            val = d.get(key)
            return val if val is not None else default

        # ── Upsert ────────────────────────────────────────────────────────
        metric_record = EssaySubmissionMetrics.query.filter_by(
            invitation_id=invitation_id
        ).first()

        # Advanced metrics for session_metadata
        new_abm = metrics.get('activityByMinute', {})
        adv_meta = {
            'medium_pauses': safe_get(metrics, 'mediumPausesCount', 0),
            'total_focus_seconds': safe_get(metrics, 'totalFocusSeconds', 0),
            'paste_count': safe_get(metrics, 'pasteCount', 0),
            'large_deletions': safe_get(metrics, 'largeDeletionsCount', 0),
            'longest_burst': safe_get(metrics, 'longestBurst', 0),
            'activity_by_minute': new_abm,  # será reemplazado por merged_abm si hay registro existente
        }

        if metric_record:
            # Update existing record
            metric_record.total_time_seconds    = safe_get(metrics, 'totalTimeSeconds',     metric_record.total_time_seconds)
            metric_record.effective_time_seconds= safe_get(metrics, 'effectiveTypingSeconds',metric_record.effective_time_seconds)
            metric_record.keystrokes            = safe_get(metrics, 'totalKeystrokes',       metric_record.keystrokes)
            metric_record.backspaces            = safe_get(metrics, 'backspacesCount',       metric_record.backspaces)
            metric_record.avg_hold_ms           = safe_get(metrics, 'avgHoldTimeMs',         metric_record.avg_hold_ms)
            metric_record.avg_interkey_ms       = safe_get(metrics, 'avgInterKeyMs',         metric_record.avg_interkey_ms)
            metric_record.long_pauses           = safe_get(metrics, 'longPausesCount',       metric_record.long_pauses)
            metric_record.wpm                   = safe_get(metrics, 'approxWPM',             metric_record.wpm)

            # FIX: Merge incremental de activity_by_minute en lugar de sobreescribir.
            # El frontend acumula desde el inicio de la sesión, por eso usamos max()
            # para conservar siempre el valor más alto (el más actualizado) por minuto.
            existing_meta = dict(metric_record.session_metadata or {})
            existing_abm  = existing_meta.get('activity_by_minute', {})
            merged_abm = dict(existing_abm)
            for k, v in new_abm.items():
                str_k = str(k)
                merged_abm[str_k] = max(int(merged_abm.get(str_k, 0)), int(v or 0))
            adv_meta['activity_by_minute'] = merged_abm
            metric_record.session_metadata = adv_meta

            # Append raw_logs (keep last 1 000 events)
            new_logs = metrics.get('rawLogs', [])
            if new_logs:
                existing = metric_record.raw_logs or []
                combined = existing + new_logs
                metric_record.raw_logs = combined[-1000:]

            if quill_delta:    metric_record.quill_delta    = quill_delta
            if signature_data: metric_record.signature_data = signature_data

            status_code = 200
        else:
            # Create new record
            metric_record = EssaySubmissionMetrics(
                document_id              = document_id,
                workspace_id             = workspace_id,
                invitation_id            = invitation_id,
                total_time_seconds       = safe_get(metrics, 'totalTimeSeconds', 0),
                effective_time_seconds   = safe_get(metrics, 'effectiveTypingSeconds', 0),
                keystrokes               = safe_get(metrics, 'totalKeystrokes', 0),
                backspaces               = safe_get(metrics, 'backspacesCount', 0),
                avg_hold_ms              = safe_get(metrics, 'avgHoldTimeMs', 0),
                avg_interkey_ms          = safe_get(metrics, 'avgInterKeyMs', 0),
                long_pauses              = safe_get(metrics, 'longPausesCount', 0),
                wpm                      = safe_get(metrics, 'approxWPM', 0),
                raw_logs                 = (metrics.get('rawLogs', []) or [])[-1000:],
                session_metadata         = adv_meta,
                quill_delta              = quill_delta,
                signature_data           = signature_data,
            )
            db.session.add(metric_record)
            status_code = 201

        db.session.commit()

        # ── HANDLE FINAL SUBMISSION ─────────────────────────────────────────
        if is_final:
            invitation.status = 'completed'
            db.session.commit()
            # Invalidate workspace detail and list cache for this workspace
            cache.delete(f"ws:list:{invitation.workspace.owner_id}")
            cache.delete(f"ws:detail:{workspace_id}")
            current_app.logger.info(f'[metrics] Invitation {invitation_id} marked as COMPLETED.')

        # FIX: Invalidar cache Redis para que el profesor vea los datos actualizados
        # inmediatamente en lugar de ver el snapshot stale hasta que expire el TTL.
        try:
            cache.delete(f"metrics:detail:{metric_record.id}")
        except Exception as cache_err:
            current_app.logger.warning(f'[metrics] Cache invalidation failed (non-critical): {cache_err}')

        return jsonify({
            'success':       True,
            'submission_id': metric_record.id,
            'message':       'Metrics updated' if status_code == 200 else 'Metrics saved',
        }), status_code

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'[metrics] Error saving metrics: {e}')
        current_app.logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


@metrics_bp.route('/api/task-submissions/<int:workspace_id>', methods=['GET'])
@login_required
def get_task_submissions(workspace_id):
    """
    Devuelve la lista de entregas (métricas resumen) para un workspace
    (El profesor accede a la lista de estudiantes de este workspace)
    """
    try:
        submissions = EssaySubmissionMetrics.query.filter_by(workspace_id=workspace_id).order_by(EssaySubmissionMetrics.submitted_at.desc()).all()
        return jsonify({
            'success': True,
            'submissions': [sub.to_dict() for sub in submissions]
        }), 200
    except Exception as e:
        current_app.logger.error(f"Error fetching submissions: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


@metrics_bp.route('/api/submission-metrics/<int:submission_id>', methods=['GET'])
@login_required
def get_submission_metrics_detail(submission_id):
    """
    Devuelve el detalle completo de una métrica (incluye gráficos y raw_logs).
    Cacheado por 120s en Redis para reducir queries repetidas cuando el profesor
    abre/cierra el modal múltiples veces.
    """
    try:
        # 1. Intentar cache Redis (TTL 120s)
        cache_key = f"metrics:detail:{submission_id}"
        cached = cache.get(cache_key)
        if cached:
            return jsonify(cached)
        
        # 2. Query MySQL — join con invitation para datos del estudiante
        metric = EssaySubmissionMetrics.query.get(submission_id)
        if not metric:
            return jsonify({'success': False, 'error': 'Submission not found'}), 404
            
        data = metric.to_dict()
        data['raw_logs'] = metric.raw_logs or []
        
        # Generate secure URL token wrapper to prevent IDOR on review views
        from itsdangerous.url_safe import URLSafeTimedSerializer
        signer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        secure_token = signer.dumps({'document_id': metric.document_id})
        data['secure_review_url'] = f"/review/{secure_token}"
        
        # quill_delta: no se incluye por defecto para ahorrar ancho de banda.
        # El documento real vive en marktrack_documents.content_delta.
        data['quill_delta'] = None
        data['signature_data'] = metric.signature_data
        
        # 3. Pre-procesar activity_by_minute: normalizar claves a 0-based.
        # Si el frontend envíó claves absolutas (legacy), las remapeamos de forma segura.
        session_meta = data.get('session_metadata') or {}
        raw_activity = session_meta.get('activity_by_minute', {})
        if raw_activity:
            session_meta['activity_by_minute'] = _normalize_activity_keys(raw_activity)
            data['session_metadata'] = session_meta
        
        # 4. Enrich pre-fix records: when keystrokes/WPM columns are zero but
        #    activity_by_minute has data (student WAS typing, listeners just weren't attached).
        #    This is a read-time enrichment—DB stays untouched.
        abm = session_meta.get('activity_by_minute', {})
        abm_total_ks = sum(int(v) for v in abm.values() if v) if abm else 0

        if not data.get('keystrokes') and abm_total_ks > 0:
            data['keystrokes'] = abm_total_ks

        if not data.get('wpm'):
            eff_secs = data.get('effective_time_seconds') or 0
            eff_min  = eff_secs / 60
            ks_for_wpm = data.get('keystrokes') or abm_total_ks
            # proxy: ~5 keystrokes per word (same formula as typing-metrics.js)
            if eff_min > 0 and ks_for_wpm > 0:
                data['wpm'] = round((ks_for_wpm / 5) / eff_min, 1)

        response_data = {'success': True, 'data': data}
        
        # 5. Cachear resultado por 30 segundos
        cache.set(cache_key, response_data, ttl=30)
        
        return jsonify(response_data), 200
    except Exception as e:
        current_app.logger.error(f"Error fetching submission detail: {str(e)}")
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


def _normalize_activity_keys(activity_map: dict) -> dict:
    """
    Normaliza las claves de activity_by_minute a índices 0-based (0, 1, 2, ...).
    
    Si las claves ya son 0-based (nuevo sistema), las devuelve sin cambios.
    Si son timestamps UNIX absolutos en minutos (~29M, sistema legacy), las remapea
    a índices relativos para que el chart no intente iterar millones de puntos.
    """
    if not activity_map:
        return {}
    
    keys = sorted(activity_map.keys(), key=lambda k: int(k))
    max_key = int(keys[-1]) if keys else 0
    
    # Heurística: si la clave máxima supera 10000 (imposible en una sesión de escritura
    # normal de horas), son timestamps UNIX absolutos — remap necesario.
    if max_key <= 10000:
        # Ya son índices relativos — devolver tal cual
        return {str(k): v for k, v in activity_map.items()}
    
    # Remap: convertir timestamps absolutos a índices 0, 1, 2...
    current_app.logger.info(
        f'[metrics] Remapping legacy absolute activity_by_minute keys (max={max_key})'
    )
    normalized = {}
    for idx, key in enumerate(keys):
        normalized[str(idx)] = activity_map[key]
    return normalized
