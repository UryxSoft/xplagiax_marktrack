/**
 * EditorFind — floating in-document search for Quill-based editors.
 *
 * Compatible with:
 *   - review.html  (read-only, professor view)
 *   - invite.html  (editable, student view)
 *
 * Usage:
 *   EditorFind.init();          // call after DOM ready
 *   EditorFind.open();          // programmatic open
 *
 * Keyboard:
 *   Ctrl/Cmd + F  → open bar & focus input
 *   Enter         → next match
 *   Shift + Enter → previous match
 *   Esc           → close & clear highlights
 */
(function (global) {
  'use strict';

  /* ── Quill Integration ─────────────────────────────────────── */
  
  // Register a custom inline format for search highlighting
  if (typeof Quill !== 'undefined') {
    const Inline = Quill.import('blots/inline');
    
    class SearchHighlight extends Inline {
      static create(value) {
        return super.create(value);
      }
      static formats(domNode) { return true; }
    }
    SearchHighlight.blotName = 'search-highlight';
    SearchHighlight.tagName = 'SPAN';
    SearchHighlight.className = 'search-highlight';
    Quill.register(SearchHighlight, true);

    class SearchActive extends Inline {
      static create(value) {
        return super.create(value);
      }
      static formats(domNode) { return true; }
    }
    SearchActive.blotName = 'search-active';
    SearchActive.tagName = 'SPAN';
    SearchActive.className = 'search-active';
    Quill.register(SearchActive, true);
  }

  /* ── State ─────────────────────────────────────────────────── */
  var _matches  = [];    // array of objects { index, length, quill }
  var _current  = -1;    // index in _matches
  var _query    = '';    // last search string
  var _debounce = null;

  /* ── DOM refs (set in init) ─────────────────────────────────── */
  var _bar, _input, _count, _btnPrev, _btnNext;

  function _escapeRe(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ── Highlight engine ───────────────────────────────────────── */

  function _applyHighlights(query) {
    _clearHighlights();
    _matches = [];
    if (!query || query.length < 2) { _updateCount(); return; }

    const quill = window.quillPagination ? window.quillPagination.getQuill() : null;
    if (!quill) return;

    const text = quill.getText();
    const re = new RegExp(_escapeRe(query), 'gi');
    let match;

    while ((match = re.exec(text)) !== null) {
      const matchIndex = match.index;
      const matchLength = match[0].length;
      
      _matches.push({ index: matchIndex, length: matchLength, quill: quill });
      
      // Apply the basic highlight format SILENTLY
      quill.formatText(matchIndex, matchLength, { 'search-highlight': true }, 'silent');
    }

    _current = _matches.length > 0 ? 0 : -1;
    _activateCurrent();
    _updateCount();
  }

  /** Remove all highlight marks via Quill format. */
  function _clearHighlights() {
    const quill = window.quillPagination ? window.quillPagination.getQuill() : null;
    if (!quill) return;

    if (_matches && _matches.length > 0) {
      // Remove formats only from previously matched ranges to preserve other text formatting
      _matches.forEach(m => {
        quill.formatText(m.index, m.length, { 'search-highlight': false, 'search-active': false }, 'silent');
      });
    }
    _matches = [];
    _current = -1;
  }

  /** Set the visual active state on the current match and scroll to it. */
  function _activateCurrent() {
    const quill = window.quillPagination ? window.quillPagination.getQuill() : null;
    if (!quill) return;

    // Reset all matches to regular highlight first
    _matches.forEach(m => {
      quill.formatText(m.index, m.length, { 'search-active': false, 'search-highlight': true }, 'silent');
    });

    if (_current >= 0 && _matches[_current]) {
      const match = _matches[_current];
      // Set the active highlight
      quill.formatText(match.index, match.length, { 'search-active': true }, 'silent');
      
      // Scroll to match using a targeted anchor for robust behavior
      const bounds = quill.getBounds(match.index);
      if (bounds && quill.root.parentNode) {
        const anchor = document.createElement('div');
        anchor.style.position = 'absolute';
        anchor.style.top = bounds.top + 'px';
        anchor.style.left = bounds.left + 'px';
        anchor.style.height = bounds.height + 'px';
        anchor.style.width = '1px';
        anchor.style.pointerEvents = 'none';
        
        quill.root.parentNode.appendChild(anchor);
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Cleanup anchor after scroll
        setTimeout(() => anchor.remove(), 1500);
      }
    }
    _setNavDisabled();
  }

  function _setNavDisabled() {
    if (_btnPrev) _btnPrev.disabled = _matches.length === 0;
    if (_btnNext) _btnNext.disabled = _matches.length === 0;
  }

  /* ── Count badge ────────────────────────────────────────────── */

  function _updateCount() {
    if (!_count) return;
    var total = _matches.length;

    if (!_query) {
      _count.textContent = '';
      _count.className   = 'find-count';
      return;
    }
    if (total === 0) {
      _count.textContent = 'No results';
      _count.className   = 'find-count no-results';
      return;
    }
    _count.textContent = (_current + 1) + ' / ' + total;
    _count.className   = 'find-count has-results';
  }

  /* ── Navigation ─────────────────────────────────────────────── */

  function _next() {
    if (_matches.length === 0) return;
    _current = (_current + 1) % _matches.length;
    _activateCurrent();
    _updateCount();
  }

  function _prev() {
    if (_matches.length === 0) return;
    _current = (_current - 1 + _matches.length) % _matches.length;
    _activateCurrent();
    _updateCount();
  }

  /* ── Open / Close ───────────────────────────────────────────── */

  function _open() {
    if (!_bar) return;
    _bar.style.display = 'flex';
    _input.focus();
    _input.select();
    // Re-search if there is already a query but no matches (e.g. re-opened after close)
    if (_query && _matches.length === 0) {
      _applyHighlights(_query);
    }
  }

  function _close() {
    if (!_bar) return;
    _bar.style.display = 'none';
    _clearHighlights();
    _query         = '';
    _input.value   = '';
    _updateCount();
  }

  /* ── Init ───────────────────────────────────────────────────── */

  function init() {
    _bar     = document.getElementById('editorFind');
    _input   = document.getElementById('findInput');
    _count   = document.getElementById('findCount');
    _btnPrev = document.getElementById('findPrev');
    _btnNext = document.getElementById('findNext');

    if (!_bar || !_input) {
      console.warn('[EditorFind] Missing DOM elements — init aborted.');
      return;
    }

    /* Input: debounced search */
    _input.addEventListener('input', function () {
      _query = _input.value;           // keep raw value (spaces included)
      clearTimeout(_debounce);
      _debounce = setTimeout(function () {
        _applyHighlights(_query.trim());
      }, 180);
    });

    /* Input: keyboard shortcuts */
    _input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.shiftKey ? _prev() : _next();
      } else if (e.key === 'Escape') {
        _close();
      }
    });

    /* Buttons */
    if (_btnPrev) _btnPrev.addEventListener('click', _prev);
    if (_btnNext) _btnNext.addEventListener('click', _next);

    var closeBtn = document.getElementById('findClose');
    if (closeBtn) closeBtn.addEventListener('click', _close);

    /* Open button in header (optional — may not exist in both screens) */
    var openBtn = document.getElementById('findOpenBtn');
    if (openBtn) openBtn.addEventListener('click', _open);

    /* Global Ctrl/Cmd + F */
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        _open();
      } else if (e.key === 'Escape' && _bar.style.display !== 'none') {
        _close();
      }
    });

    /* Clicking outside the bar closes it */
    document.addEventListener('mousedown', function (e) {
      if (_bar.style.display !== 'none' && !_bar.contains(e.target)) {
        var openBtnEl = document.getElementById('findOpenBtn');
        if (openBtnEl && openBtnEl.contains(e.target)) return;
        _close();
      }
    });

    _setNavDisabled();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  global.EditorFind = {
    init  : init,
    open  : _open,
    close : _close,
    next  : _next,
    prev  : _prev,
  };

})(window);
