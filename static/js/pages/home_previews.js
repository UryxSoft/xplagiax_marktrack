/**
 * ====================================================
 * home_previews.js — Document Preview Service
 * Extracts plain-text snippets from .doc/.docx blobs
 * and inserts them into .doc-preview containers.
 *
 * Dependencies: docToText.js (loaded before this file)
 * ====================================================
 */
(function () {
  'use strict';

  /* ─── Constants ─────────────────────────────────── */
  const PREVIEW_CHARS = 380;         // target character limit
  const LOAD_ENDPOINT = '/api/document/{id}/load'; // {id} replaced at runtime
  const PLACEHOLDER   = 'No preview available';
  const EMPTY_PLACEHOLDER = 'Empty document';
  const SUPPORTED_EXT = new Set(['doc', 'docx']);

  /* ─── Session cache: docId → extracted text ──────── */
  const _cache = new Map();

  /* ─── Active extraction promises to avoid duplicates ─ */
  const _pending = new Map();

  /* ─── IntersectionObserver instance ─────────────── */
  let _observer = null;

  /* ──────────────────────────────────────────────────
     Utility: clean & truncate raw text
  ────────────────────────────────────────────────── */
  function _sanitize(raw) {
    if (!raw || typeof raw !== 'string') return '';

    // Collapse whitespace / newlines
    let text = raw
      .replace(/\r\n/g, '\n')
      .replace(/[\t ]+/g, ' ')                 // multiple spaces → single
      .replace(/\n{3,}/g, '\n\n')              // max 2 consecutive newlines
      .trim();

    if (!text) return '';

    // Truncate at word boundary
    if (text.length > PREVIEW_CHARS) {
      const cut = text.lastIndexOf(' ', PREVIEW_CHARS);
      text = text.slice(0, cut > 0 ? cut : PREVIEW_CHARS).trimEnd() + '\u2026'; // …
    }

    return text;
  }

  /* ──────────────────────────────────────────────────
     Core: extract text from a Blob or File object
     Returns Promise<string>
  ────────────────────────────────────────────────── */
  async function _extractFromBlob(blob, extension) {
    const ext = (extension || '').toLowerCase().replace('.', '');

    if (!SUPPORTED_EXT.has(ext)) {
      return '';
    }

    // docToText.js exposes a global `DocToText` constructor
    if (typeof DocToText === 'undefined') {
      console.warn('[DocPreview] DocToText library not loaded.');
      return '';
    }

    try {
      const docToText = new DocToText();
      const raw = await docToText.extractToText(blob, ext);
      return _sanitize(raw);
    } catch (err) {
      console.warn('[DocPreview] Extraction failed:', err);
      return '';
    }
  }

  /* ──────────────────────────────────────────────────
     Core: fetch raw document content from backend and
     convert its HTML to plain text (fallback approach
     when we don't have the File blob at render time).
  ────────────────────────────────────────────────── */
  async function _extractFromEndpoint(docId) {
    const url = LOAD_ENDPOINT.replace('{id}', docId);
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) return '';

      const data = await resp.json();

      // Prefer HTML content for text extraction
      if (data.html) {
        const tmp = document.createElement('div');
        // Clean HTML: Remove <img> tags and other non-textual assets before parsing
        // to prevent triggering unnecessary (and potentially 404) resource loads.
        const cleanHtml = data.html.replace(/<img[^>]*>/gi, '');
        tmp.innerHTML = cleanHtml;
        return _sanitize(tmp.textContent || tmp.innerText || '');
      }

      // Fallback: parse Quill delta if available
      if (data.delta && data.delta.ops) {
        const text = data.delta.ops
          .filter(op => typeof op.insert === 'string')
          .map(op => op.insert)
          .join('');
        return _sanitize(text);
      }

      return '';
    } catch (err) {
      console.warn('[DocPreview] Fetch failed for doc', docId, err);
      return '';
    }
  }

  /* ──────────────────────────────────────────────────
     DOM helper: find the .doc-preview element for a
     given docId (data-doc-idx attribute).
  ────────────────────────────────────────────────── */
  function _getPreviewEl(docId) {
    const outer = document.querySelector(`.doc-outer[data-doc-idx="${docId}"]`);
    return outer ? outer.querySelector('.doc-preview') : null;
  }

  /* ──────────────────────────────────────────────────
     DOM helper: write the preview text (or placeholder)
     into the element and remove the loading class.
  ────────────────────────────────────────────────── */
  function _renderPreview(docId, text) {
    const el = _getPreviewEl(docId);
    if (!el) return;

    el.classList.remove('doc-preview--loading');

    if (!text) {
      el.textContent = EMPTY_PLACEHOLDER;
      el.classList.add('doc-preview--empty');
    } else {
      el.textContent = text;
      el.classList.remove('doc-preview--empty');
    }
  }

  /* ──────────────────────────────────────────────────
     Public: load and render the preview for one doc.
     Accepts optional `blob` + `extension` for immediate
     extraction (e.g. right after upload).
  ────────────────────────────────────────────────── */
  async function loadPreview(docId, blob, extension) {
    // Return immediately if already cached
    if (_cache.has(docId)) {
      _renderPreview(docId, _cache.get(docId));
      return;
    }

    // Avoid duplicate concurrent requests for the same doc
    if (_pending.has(docId)) {
      const text = await _pending.get(docId);
      _renderPreview(docId, text);
      return;
    }

    // Show shimmer
    const el = _getPreviewEl(docId);
    if (el) {
      el.textContent = '\u00A0'; // non-breaking space keeps height
      el.classList.add('doc-preview--loading');
    }

    let promise;
    if (blob && extension) {
      promise = _extractFromBlob(blob, extension);
    } else {
      promise = _extractFromEndpoint(docId);
    }

    _pending.set(docId, promise);

    const text = await promise;
    _pending.delete(docId);
    _cache.set(docId, text);
    _renderPreview(docId, text);
  }

  /* ──────────────────────────────────────────────────
     Public: immediately store blob text (e.g. from
     upload_toast before the card even exists in the DOM).
     A subsequent renderDocs() → observer will display it.
  ────────────────────────────────────────────────── */
  async function cacheFromBlob(docId, blob, extension) {
    if (_cache.has(docId)) return;

    // Extract in background
    const text = await _extractFromBlob(blob, extension);
    _cache.set(docId, text);

    // Try to update DOM if the card already rendered
    _renderPreview(docId, text);
  }

  /* ──────────────────────────────────────────────────
     Public: initialise the IntersectionObserver.
     Call this once after each renderDocs() call.
  ────────────────────────────────────────────────── */
  function observeCards() {
    // Disconnect previous observer if present
    if (_observer) {
      _observer.disconnect();
    }

    _observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;

        const outer = entry.target;
        const docId = outer.dataset.docIdx;
        if (!docId) return;

        // Stop observing this card
        _observer.unobserve(outer);

        // Kick off preview load (async, non-blocking)
        loadPreview(docId);
      });
    }, {
      rootMargin: '80px',   // start loading 80px before visible
      threshold: 0
    });

    // Attach to every .doc-outer with a valid docId
    document.querySelectorAll('.doc-outer[data-doc-idx]').forEach(card => {
      // Skip cards that already have rendered text
      const previewEl = card.querySelector('.doc-preview');
      if (previewEl && previewEl.textContent.trim() &&
          !previewEl.classList.contains('doc-preview--loading')) {
        return;
      }
      _observer.observe(card);
    });
  }

  /* ──────────────────────────────────────────────────
     Public: fresh start. Clears cache and re-observes.
     Useful for manual refresh buttons.
  ────────────────────────────────────────────────── */
  function refreshAll() {
    _cache.clear();
    _pending.clear();
    
    // Clear existing preview texts in DOM to show they are reloading
    document.querySelectorAll('.doc-preview').forEach(el => {
      el.textContent = '\u00A0';
      el.classList.add('doc-preview--loading');
    });

    observeCards();
  }

  /* ──────────────────────────────────────────────────
     Expose public API on window
  ────────────────────────────────────────────────── */
  window.DocumentPreviewService = {
    loadPreview,
    cacheFromBlob,
    observeCards,
    refreshAll
  };

})();
