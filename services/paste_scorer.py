"""
paste_scorer.py — Heuristic engine for scoring internet-copy likelihood.

Operates entirely on client-supplied clipboard metadata. Zero external API calls.
Score range: 0–100. Records with score < 30 are discarded (low-risk noise).
"""

import re
import html
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# SIGNAL WEIGHTS
# ─────────────────────────────────────────────────────────────────────────────
_HTML_PRESENT_WEIGHT        = 20   # clipboard had text/html (browser-formatted)
_HYPERLINK_TAG_WEIGHT       = 20   # <a href=...> detected → from web page
_HTTP_URL_WEIGHT            = 20   # raw http:// or https:// in clipboard HTML
_CITATION_TAG_WEIGHT        = 10   # <cite>, <blockquote>, <sup> academic markup
_MIN_LENGTH_WEIGHT          = 10   # paste > 300 chars (unlikely manual typing burst)
_TRACKING_PARAM_WEIGHT      = 10   # utm_, ref=, source=, gclid tracking params
_STRUCTURED_HTML_WEIGHT     = 10   # <p>, <div>, <section> = full page copy

_TRACKING_RE     = re.compile(r'(utm_\w+|gclid|ref=|source=|fbclid|mc_eid)', re.I)
_URL_RE          = re.compile(r'https?://[^\s"\'<>]{4,}', re.I)
_DOMAIN_RE       = re.compile(r'https?://(?:www\.)?([^/\s"\'<>]+)', re.I)
_ALLOWED_TAGS    = re.compile(r'<(/?(b|i|u|em|strong|br|span|p|a|ul|ol|li|h[1-6]|cite|blockquote|sup|div|section)[\s>])', re.I)
_STRIP_TAGS_RE   = re.compile(r'<[^>]+>')
_STRIP_SCRIPTS   = re.compile(r'<script[\s\S]*?</script>', re.I)
_STRIP_STYLE     = re.compile(r'<style[\s\S]*?</style>', re.I)

# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

def score_paste(
    pasted_text: str,
    clipboard_html: Optional[str] = None,
    source_url: Optional[str] = None,
) -> dict:
    """
    Compute the internet_copy_score for a paste event.

    Returns:
        dict with keys:
            score       (int 0–100)
            risk_level  ('low' | 'medium' | 'high')
            source_url  (str | None)
            source_domain (str | None)
            clipboard_html_clean (str | None — sanitized)
    """
    score = 0
    has_html = bool(clipboard_html and clipboard_html.strip())

    # ── Signal 1: browser HTML present ───────────────────────────────────────
    if has_html:
        score += _HTML_PRESENT_WEIGHT
        logger.debug('[PasteScorer] +%d HTML present', _HTML_PRESENT_WEIGHT)

    # ── Signal 2: hyperlink tags ──────────────────────────────────────────────
    if has_html and re.search(r'<a\s[^>]*href', clipboard_html, re.I):
        score += _HYPERLINK_TAG_WEIGHT
        logger.debug('[PasteScorer] +%d hyperlink tags', _HYPERLINK_TAG_WEIGHT)

    # ── Signal 3: raw URLs in HTML ────────────────────────────────────────────
    detected_url: Optional[str] = source_url
    if has_html:
        url_match = _URL_RE.search(clipboard_html)
        if url_match:
            score += _HTTP_URL_WEIGHT
            detected_url = detected_url or url_match.group(0)
            logger.debug('[PasteScorer] +%d raw URL detected', _HTTP_URL_WEIGHT)

    # ── Signal 4: citation / academic markup ──────────────────────────────────
    if has_html and re.search(r'<(cite|blockquote|sup|bib|reference)', clipboard_html, re.I):
        score += _CITATION_TAG_WEIGHT
        logger.debug('[PasteScorer] +%d citation tag', _CITATION_TAG_WEIGHT)

    # ── Signal 5: long paste (>300 chars) ────────────────────────────────────
    if len(pasted_text) > 300:
        score += _MIN_LENGTH_WEIGHT
        logger.debug('[PasteScorer] +%d long paste (%d chars)', _MIN_LENGTH_WEIGHT, len(pasted_text))

    # ── Signal 6: tracking params in HTML/URL ────────────────────────────────
    haystack = (clipboard_html or '') + (detected_url or '')
    if _TRACKING_RE.search(haystack):
        score += _TRACKING_PARAM_WEIGHT
        logger.debug('[PasteScorer] +%d tracking params', _TRACKING_PARAM_WEIGHT)

    # ── Signal 7: structured page markup (<div>, <section>) ──────────────────
    if has_html and re.search(r'<(div|section|article|header|nav)\s', clipboard_html, re.I):
        score += _STRUCTURED_HTML_WEIGHT
        logger.debug('[PasteScorer] +%d structured HTML', _STRUCTURED_HTML_WEIGHT)

    score = min(score, 100)

    # ── Extract domain ────────────────────────────────────────────────────────
    source_domain: Optional[str] = None
    if detected_url:
        m = _DOMAIN_RE.search(detected_url)
        if m:
            source_domain = m.group(1)[:255]
        detected_url = detected_url[:2048]

    # ── Sanitize clipboard HTML for storage ───────────────────────────────────
    clean_html: Optional[str] = None
    if has_html:
        clean_html = _sanitize_html(clipboard_html)

    risk = 'high' if score >= 71 else ('medium' if score >= 31 else 'low')
    logger.info('[PasteScorer] score=%d risk=%s domain=%s', score, risk, source_domain)

    return {
        'score':               score,
        'risk_level':          risk,
        'source_url':          detected_url,
        'source_domain':       source_domain,
        'clipboard_html_clean': clean_html,
    }


def _sanitize_html(raw: str) -> str:
    """Strip scripts/styles and dangerous tags; keep safe structural tags."""
    cleaned = _STRIP_SCRIPTS.sub('', raw)
    cleaned = _STRIP_STYLE.sub('', cleaned)
    # Remove all tags except explicitly allowed ones
    cleaned = _STRIP_TAGS_RE.sub(' ', cleaned)
    # Collapse whitespace
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip()
    # HTML-escape remaining content to prevent XSS
    return html.escape(cleaned)[:20000]  # Hard cap at 20k chars
