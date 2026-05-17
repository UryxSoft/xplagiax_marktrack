"""
plagiarism_routes.py — Blueprint for Internet Paste Detection API

Endpoints:
    POST /api/plagiarism/register-paste   Accept paste evidence from student editor
    GET  /api/plagiarism/document/<id>    Fetch all active evidence for professor review
    POST /api/plagiarism/revalidate       Mark fragments inactive when text removed from doc
"""

import uuid
import logging
from flask import Blueprint, request, jsonify, current_app
from flask_login import current_user
from settings.extensions import db, csrf
from models.paste_evidence import PastedInternetContent
from services.paste_scorer import score_paste

logger = logging.getLogger(__name__)

plagiarism_bp = Blueprint('plagiarism', __name__, url_prefix='/api/plagiarism')
csrf.exempt(plagiarism_bp)

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
_MIN_SCORE_TO_RECORD = 0      # Record all pastes >= MIN_PASTE_CHARS
_MAX_TEXT_CHARS      = 10_000  # Truncate giant pastes before storage
_MAX_HTML_CHARS      = 50_000  # Raw clipboard HTML cap


def _get_actor_ids():
    """Return (user_id, student_id) from whatever auth context is active."""
    user_id    = None
    student_id = None
    try:
        if current_user and current_user.is_authenticated:
            user_id = current_user.id
    except Exception:
        pass
    # Student workspace auth stores student in session via student_bp
    try:
        from flask import session as flask_session
        student_id = flask_session.get('student_id')
    except Exception:
        pass
    return user_id, student_id


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/plagiarism/register-paste
# ─────────────────────────────────────────────────────────────────────────────
@plagiarism_bp.route('/register-paste', methods=['POST'])
def register_paste():
    """
    Silently receive paste evidence from the student editor.
    Applies heuristic scoring; only records if score >= MIN_SCORE.
    Returns 200 regardless of outcome (stealth — no student-visible error).
    """
    try:
        data = request.get_json(silent=True) or {}

        document_id    = data.get('document_id')
        pasted_text    = (data.get('pasted_text') or '').strip()
        clipboard_html = (data.get('clipboard_html') or '')[:_MAX_HTML_CHARS]
        source_url     = (data.get('source_url') or None)

        # Basic validation — fail silently
        if not document_id or not pasted_text:
            return jsonify({'ok': True}), 200

        pasted_text = pasted_text[:_MAX_TEXT_CHARS]

        # ── Autodetect Source URL via Search Service if not provided ──────────
        # (Resolves limitations on Mac/mobile browsers where clipboard data is stripped of SourceURL)
        if not source_url:
            try:
                from services.search_service import search_service
                # Clean up query (take first non-empty line, max 100 characters, remove quotes)
                lines = [l.strip() for l in pasted_text.split('\n') if l.strip()]
                if lines:
                    query = lines[0].replace('"', '').strip()
                    # Only search for substantial text phrases to prevent API waste
                    if len(query) >= 20:
                        logger.info('[Plagiarism] Autodetecting source_url for: "%s"', query[:50])
                        search_res = search_service.text_search(query[:100])
                        organic = search_res.get('organic_results', [])
                        if organic and isinstance(organic, list):
                            first_match = organic[0]
                            source_url = first_match.get('link')
                            logger.info('[Plagiarism] Successfully autodetected URL via search: %s', source_url)
            except Exception as search_err:
                logger.warning('[Plagiarism] Failed to autodetect URL via SearchService: %s', search_err)

        # ── Heuristic scoring ─────────────────────────────────────────────────
        result = score_paste(
            pasted_text    = pasted_text,
            clipboard_html = clipboard_html or None,
            source_url     = source_url,
        )

        if result['score'] < _MIN_SCORE_TO_RECORD:
            logger.debug('[Plagiarism] Paste discarded (score=%d < %d)', result['score'], _MIN_SCORE_TO_RECORD)
            return jsonify({'ok': True}), 200

        user_id, student_id = _get_actor_ids()

        # ── Persist evidence ──────────────────────────────────────────────────
        record = PastedInternetContent(
            document_id         = document_id,
            user_id             = user_id,
            student_id          = student_id,
            paste_uuid          = str(uuid.uuid4()),
            pasted_text         = pasted_text,
            source_url          = result['source_url'],
            source_domain       = result['source_domain'],
            clipboard_html      = result['clipboard_html_clean'],
            internet_copy_score = result['score'],
            char_count          = len(pasted_text),
            is_active           = True,
            is_removed          = False,
        )
        db.session.add(record)
        db.session.commit()

        logger.info(
            '[Plagiarism] Paste registered doc=%s score=%d domain=%s chars=%d',
            document_id, result['score'], result['source_domain'], len(pasted_text)
        )
        return jsonify({'ok': True}), 200

    except Exception as exc:
        logger.exception('[Plagiarism] register-paste error: %s', exc)
        db.session.rollback()
        return jsonify({'ok': True}), 200  # always 200 — stealth


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/plagiarism/document/<doc_id>
# ─────────────────────────────────────────────────────────────────────────────
@plagiarism_bp.route('/document/<int:doc_id>', methods=['GET'])
def get_document_evidence(doc_id: int):
    """
    Fetch all paste evidence for a document (professor view).
    Returns active + inactive fragments so the professor sees the full history.
    """
    try:
        # Require professor auth
        if not (current_user and current_user.is_authenticated):
            return jsonify({'status': 'error', 'message': 'Unauthorized'}), 401

        include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'

        query = PastedInternetContent.query.filter_by(document_id=doc_id)
        if not include_inactive:
            query = query.filter_by(is_active=True)

        records = query.order_by(PastedInternetContent.created_at.desc()).all()

        fragments = [r.to_dict() for r in records]

        # ── Aggregate stats ───────────────────────────────────────────────────
        active_records = [r for r in records if r.is_active]
        avg_score      = int(sum(r.internet_copy_score for r in active_records) / len(active_records)) \
                         if active_records else 0
        domains        = list({r.source_domain for r in active_records if r.source_domain})

        return jsonify({
            'status':    'success',
            'document_id': doc_id,
            'total':     len(fragments),
            'active':    len(active_records),
            'avg_score': avg_score,
            'domains':   domains,
            'fragments': fragments,
        })

    except Exception as exc:
        logger.exception('[Plagiarism] get_document_evidence error: %s', exc)
        return jsonify({'status': 'error', 'message': str(exc)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/plagiarism/revalidate
# ─────────────────────────────────────────────────────────────────────────────
@plagiarism_bp.route('/revalidate', methods=['POST'])
def revalidate():
    """
    Called by the student editor's DocumentSyncWatcher.
    Receives the list of paste_uuids that are NO LONGER present in the document
    and marks them is_active=False (soft-delete, preserves audit trail).
    """
    try:
        data             = request.get_json(silent=True) or {}
        document_id      = data.get('document_id')
        removed_uuids    = data.get('removed_uuids', [])   # list of paste_uuid strings
        still_present    = data.get('still_present', [])   # list of paste_uuid strings

        if not document_id:
            return jsonify({'ok': True}), 200

        deactivated = 0
        if removed_uuids:
            rows = PastedInternetContent.query.filter(
                PastedInternetContent.document_id == document_id,
                PastedInternetContent.paste_uuid.in_(removed_uuids),
                PastedInternetContent.is_active == True,
            ).all()
            for row in rows:
                row.is_active  = False
                row.is_removed = True
                deactivated   += 1

        if deactivated:
            db.session.commit()
            logger.info('[Plagiarism] Revalidate doc=%s deactivated=%d', document_id, deactivated)

        return jsonify({'ok': True, 'deactivated': deactivated}), 200

    except Exception as exc:
        logger.exception('[Plagiarism] revalidate error: %s', exc)
        db.session.rollback()
        return jsonify({'ok': True}), 200
