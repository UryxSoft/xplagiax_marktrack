/**
 * editor-shortcuts.js — Universal Keyboard Shortcut Engine for MarkTrack Editors
 * Works on: invite.html, documentedit.html
 *
 * Strategy:
 *  - Quill already owns: Ctrl+B/I/U/Z/Y/A — we NEVER override those.
 *  - We intercept only shortcuts Quill does NOT handle natively.
 *  - All handlers check if focus is inside the editor before acting.
 *  - Ctrl+V (paste) is explicitly ALLOWED — never blocked.
 */
(function () {
    'use strict';

    // ─── FONT SIZE MAP (Quill named sizes → approximate pt) ──────────────────
    const SIZE_CYCLE = ['small', false, 'large', 'huge']; // false = normal/default

    // ─── RESOLVE QUILL ───────────────────────────────────────────────────────
    function _getQuill() {
        const pag = window.quillPagination;
        if (!pag) return null;
        return pag.quill || (pag.pages && pag.pages[0] && pag.pages[0].quill) || null;
    }

    function _editorFocused() {
        const active = document.activeElement;
        if (!active) return false;
        return active.closest('.ql-editor, #editor-pages') !== null ||
               active.classList.contains('ql-editor');
    }

    // ─── FORMAT HELPERS ──────────────────────────────────────────────────────
    function _fmt(name, value) {
        const q = _getQuill(); if (!q) return;
        q.format(name, value, 'user');
    }

    function _getSelText() {
        const q = _getQuill(); if (!q) return '';
        const range = q.getSelection();
        if (!range || range.length === 0) return '';
        return q.getText(range.index, range.length);
    }

    function _replaceSelText(newText) {
        const q = _getQuill(); if (!q) return;
        const range = q.getSelection();
        if (!range || range.length === 0) return;
        q.deleteText(range.index, range.length, 'user');
        q.insertText(range.index, newText, 'user');
        q.setSelection(range.index, newText.length);
    }

    function _cycleFontSize(direction) {
        const q = _getQuill(); if (!q) return;
        const range = q.getSelection(); if (!range) return;
        const current = q.getFormat(range).size || false;
        let idx = SIZE_CYCLE.indexOf(current);
        if (idx === -1) idx = 1; // default
        idx = Math.max(0, Math.min(SIZE_CYCLE.length - 1, idx + direction));
        _fmt('size', SIZE_CYCLE[idx]);
    }

    function _setAlign(value) { _fmt('align', value); }
    function _setIndent(delta) { _fmt('indent', delta); }

    function _setLineHeight(value) {
        // Quill v2 doesn't have built-in line-height format; apply via CSS on ql-editor
        const q = _getQuill(); if (!q) return;
        q.root.style.lineHeight = value;
    }

    function _toggleCase() {
        const text = _getSelText();
        if (!text) return;
        const hasLower = /[a-z]/.test(text);
        _replaceSelText(hasLower ? text.toUpperCase() : text.toLowerCase());
    }

    function _openFind() {
        // editor-find.js exposes EditorFind.open()
        if (window.EditorFind && typeof window.EditorFind.open === 'function') {
            window.EditorFind.open();
        } else {
            const btn = document.getElementById('findOpenBtn');
            if (btn) btn.click();
            else {
                const bar = document.getElementById('editorFind');
                if (bar) { bar.style.display = 'flex'; const inp = document.getElementById('findInput'); if (inp) inp.focus(); }
            }
        }
    }

    function _save() {
        // invite.html — manual save button
        const saveBtn = document.getElementById('saveDraftBtn');
        if (saveBtn) { saveBtn.click(); return; }
    }

    function _print() {
        window.print();
    }

    function _newDoc() {
        window.open('/home', '_blank');
    }

    function _openDoc() {
        window.location.href = '/home';
    }

    function _closeDoc() {
        // Try close first (if opened as tab), else go home
        if (window.history.length > 1) window.history.back();
        else window.close();
    }

    // ─── SHORTCUT MAP ────────────────────────────────────────────────────────
    // Each entry: { ctrl, shift, alt, key (lowercase), fn, preventDefault }
    const SHORTCUTS = [
        // ── File operations
        { ctrl:true,  shift:false, key:'n', fn: _newDoc,            pd:true  },
        { ctrl:true,  shift:false, key:'o', fn: _openDoc,           pd:true  },
        { ctrl:true,  shift:false, key:'s', fn: _save,              pd:true  },
        { ctrl:true,  shift:false, key:'p', fn: _print,             pd:true  },
        { ctrl:true,  shift:false, key:'w', fn: _closeDoc,          pd:true  },

        // ── Find (Quill doesn't own Ctrl+F by default in some browsers)
        { ctrl:true,  shift:false, key:'f', fn: _openFind,          pd:true  },

        // ── Help modal
        { ctrl:true,  shift:false, key:'/', fn: openShortcutsModal, pd:true  },

        // ── Formatting (alignment)
        { ctrl:true,  shift:false, key:'e', fn:()=>_setAlign('center'),  pd:true },
        { ctrl:true,  shift:false, key:'l', fn:()=>_setAlign(''),        pd:true },
        { ctrl:true,  shift:false, key:'r', fn:()=>_setAlign('right'),   pd:true },
        { ctrl:true,  shift:false, key:'j', fn:()=>_setAlign('justify'), pd:true },

        // ── Indent
        { ctrl:true,  shift:false, key:'m', fn:()=>_setIndent('+1'),  pd:true },
        { ctrl:true,  shift:true,  key:'m', fn:()=>_setIndent('-1'),  pd:true },

        // ── Hanging indent (simulate via indent+format)
        { ctrl:true,  shift:false, key:'t', fn:()=>{ _setIndent('+1'); }, pd:true },

        // ── Font size cycle
        { ctrl:true,  shift:true,  key:'.', fn:()=>_cycleFontSize(+1), pd:true },  // Ctrl+Shift+>
        { ctrl:true,  shift:true,  key:',', fn:()=>_cycleFontSize(-1), pd:true },  // Ctrl+Shift+<
        { ctrl:true,  shift:false, key:']', fn:()=>_cycleFontSize(+1), pd:true },
        { ctrl:true,  shift:false, key:'[', fn:()=>_cycleFontSize(-1), pd:true },

        // ── Case toggle
        { ctrl:true,  shift:true,  key:'a', fn:()=>_toggleCase(),    pd:true },
        { ctrl:false, shift:true,  key:'f3',fn:()=>_toggleCase(),    pd:true },

        // ── Line spacing
        { ctrl:true,  shift:false, key:'1', fn:()=>_setLineHeight('1.0'),  pd:true },
        { ctrl:true,  shift:false, key:'2', fn:()=>_setLineHeight('2.0'),  pd:true },
        { ctrl:true,  shift:false, key:'5', fn:()=>_setLineHeight('1.5'),  pd:true },

        // ── Double underline (custom span injection)
        { ctrl:true,  shift:true,  key:'d', fn:()=>_fmt('underline', true), pd:true },

        // ── Ctrl+V — EXPLICITLY DO NOTHING (let browser/Quill handle paste)
        // (not in this map — no entry means not intercepted)
    ];

    // ─── GLOBAL KEY HANDLER ──────────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        // Never intercept if focus is in a text input outside editor
        const tag = document.activeElement?.tagName;
        const isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
        const inEditor = _editorFocused();

        // Ctrl+/ opens help from anywhere
        if (e.ctrlKey && e.key === '/') { e.preventDefault(); openShortcutsModal(); return; }

        // File ops work from anywhere, formatting only when editor focused
        for (const sc of SHORTCUTS) {
            const ctrlMatch  = sc.ctrl  ? e.ctrlKey  : !e.ctrlKey;
            const shiftMatch = sc.shift ? e.shiftKey : !e.shiftKey;
            const keyMatch   = e.key.toLowerCase() === sc.key;

            if (!ctrlMatch || !shiftMatch || !keyMatch) continue;

            const isFileOp = ['n','o','s','p','w'].includes(sc.key);
            if (!isFileOp && isInput) continue;
            if (!isFileOp && !inEditor && !isInput) continue;

            if (sc.pd) e.preventDefault();
            sc.fn();
            return;
        }
    }, false);

    // ─────────────────────────────────────────────────────────────────────────
    // HELP MODAL
    // ─────────────────────────────────────────────────────────────────────────
    const SHORTCUT_TABLE = [
        { category: 'File & Document' },
        { combo: 'Ctrl + N',          action: 'New document (opens home)' },
        { combo: 'Ctrl + O',          action: 'Open document (go to home)' },
        { combo: 'Ctrl + S',          action: 'Save document' },
        { combo: 'Ctrl + P',          action: 'Print document' },
        { combo: 'Ctrl + W',          action: 'Close / go back' },
        { combo: 'Ctrl + /',          action: 'Open this shortcut reference' },

        { category: 'Editing' },
        { combo: 'Ctrl + C',          action: 'Copy' },
        { combo: 'Ctrl + X',          action: 'Cut' },
        { combo: 'Ctrl + V',          action: 'Paste' },
        { combo: 'Ctrl + Z',          action: 'Undo' },
        { combo: 'Ctrl + Y',          action: 'Redo' },
        { combo: 'Ctrl + A',          action: 'Select all' },
        { combo: 'Ctrl + F',          action: 'Find in document' },

        { category: 'Text Formatting' },
        { combo: 'Ctrl + B',          action: 'Bold' },
        { combo: 'Ctrl + I',          action: 'Italic' },
        { combo: 'Ctrl + U',          action: 'Underline' },
        { combo: 'Ctrl + Shift + D',  action: 'Double underline' },
        { combo: 'Ctrl + Shift + A',  action: 'Toggle UPPERCASE / lowercase' },
        { combo: 'Shift + F3',        action: 'Cycle letter case' },

        { category: 'Font Size' },
        { combo: 'Ctrl + Shift + >',  action: 'Increase font size' },
        { combo: 'Ctrl + Shift + <',  action: 'Decrease font size' },
        { combo: 'Ctrl + ]',          action: 'Increase font size (step)' },
        { combo: 'Ctrl + [',          action: 'Decrease font size (step)' },

        { category: 'Paragraphs & Alignment' },
        { combo: 'Ctrl + E',          action: 'Center text' },
        { combo: 'Ctrl + L',          action: 'Align left' },
        { combo: 'Ctrl + R',          action: 'Align right' },
        { combo: 'Ctrl + J',          action: 'Justify' },
        { combo: 'Ctrl + M',          action: 'Increase indent' },
        { combo: 'Ctrl + Shift + M',  action: 'Decrease indent' },
        { combo: 'Ctrl + T',          action: 'Hanging indent' },

        { category: 'Line Spacing' },
        { combo: 'Ctrl + 1',          action: 'Single spacing (1.0)' },
        { combo: 'Ctrl + 5',          action: '1.5 line spacing' },
        { combo: 'Ctrl + 2',          action: 'Double spacing (2.0)' },
    ];

    function _buildModalHTML() {
        let rows = '';
        for (const row of SHORTCUT_TABLE) {
            if (row.category) {
                rows += `<tr class="ks-cat-row"><td colspan="2">${row.category}</td></tr>`;
            } else {
                rows += `<tr>
                    <td><kbd class="ks-kbd">${row.combo}</kbd></td>
                    <td class="ks-action">${row.action}</td>
                </tr>`;
            }
        }
        return `
<div id="editorShortcutsModal" class="ks-overlay" onclick="if(event.target===this)closeShortcutsModal()" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
  <div class="ks-modal">
    <div class="ks-header">
      <div class="ks-header-left">
        <div class="ks-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"/>
          </svg>
        </div>
        <div>
          <h2 class="ks-title">Keyboard Shortcuts</h2>
          <p class="ks-subtitle">MarkTrack Editor Reference</p>
        </div>
      </div>
      <button class="ks-close" onclick="closeShortcutsModal()" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>

    <div class="ks-search-bar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input type="text" id="ksSearch" placeholder="Search shortcuts…" autocomplete="off" oninput="filterShortcuts(this.value)">
    </div>

    <div class="ks-body">
      <table class="ks-table" id="ksTable">
        <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
        <tbody id="ksTableBody">${rows}</tbody>
      </table>
    </div>

    <div class="ks-footer">
      <span class="ks-tip">
        <kbd class="ks-kbd ks-kbd-sm">Ctrl</kbd> + <kbd class="ks-kbd ks-kbd-sm">/</kbd> &nbsp;to open this panel anytime
      </span>
      <button class="ks-btn-close" onclick="closeShortcutsModal()">Got it</button>
    </div>
  </div>
</div>

<style>
/* ── Keyboard Shortcuts Modal ──────────────────────────────────────────── */
.ks-overlay {
    display        : none;
    position       : fixed;
    inset          : 0;
    z-index        : 99999;
    background     : rgba(8, 12, 28, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    align-items    : center;
    justify-content: center;
    padding        : 20px;
    animation      : ksFadeIn .2s ease;
}
.ks-overlay.ks-open { display: flex; }

@keyframes ksFadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes ksSlideIn { from { opacity:0; transform:translateY(24px) scale(.97) } to { opacity:1; transform:none } }

.ks-modal {
    background     : linear-gradient(145deg, rgba(20,26,46,.98), rgba(12,16,34,.98));
    border         : 1px solid rgba(255,255,255,.1);
    border-top     : 1px solid rgba(255,255,255,.18);
    border-radius  : 22px;
    width          : min(680px, 95vw);
    max-height     : 88vh;
    display        : flex;
    flex-direction : column;
    box-shadow     : 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04);
    animation      : ksSlideIn .28s cubic-bezier(.34,1.56,.64,1);
    overflow       : hidden;
}

/* Header */
.ks-header {
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    padding        : 22px 28px 16px;
    border-bottom  : 1px solid rgba(255,255,255,.06);
    flex-shrink    : 0;
}
.ks-header-left { display:flex; align-items:center; gap:14px; }
.ks-icon {
    width          : 44px; height:44px;
    background     : linear-gradient(135deg,rgba(99,102,241,.25),rgba(139,92,246,.25));
    border         : 1px solid rgba(99,102,241,.35);
    border-radius  : 12px;
    display        : flex; align-items:center; justify-content:center;
    color          : #a78bfa;
    flex-shrink    : 0;
}
.ks-title  { margin:0; font-size:18px; font-weight:700; color:#f8fafc; letter-spacing:-.02em; }
.ks-subtitle { margin:2px 0 0; font-size:11px; color:rgba(255,255,255,.35); font-weight:500; }
.ks-close {
    width:34px; height:34px; border-radius:50%;
    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);
    color:rgba(255,255,255,.5); cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:all .2s; flex-shrink:0;
}
.ks-close:hover { background:rgba(239,68,68,.15); border-color:rgba(239,68,68,.3); color:#f87171; }

/* Search */
.ks-search-bar {
    display     : flex; align-items:center; gap:10px;
    margin      : 14px 28px;
    background  : rgba(255,255,255,.04);
    border      : 1px solid rgba(255,255,255,.09);
    border-radius: 10px;
    padding     : 9px 14px;
    flex-shrink : 0;
    color       : rgba(255,255,255,.35);
}
.ks-search-bar input {
    flex:1; background:none; border:none; outline:none;
    font-size:13px; color:#f8fafc; font-weight:500;
}
.ks-search-bar input::placeholder { color:rgba(255,255,255,.25); }

/* Body / table */
.ks-body {
    overflow-y   : auto;
    flex         : 1;
    padding      : 0 28px 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.1) transparent;
}
.ks-body::-webkit-scrollbar { width:5px; }
.ks-body::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:3px; }

.ks-table {
    width      : 100%;
    border-collapse: collapse;
    font-size  : 13px;
}
.ks-table thead th {
    padding     : 8px 12px;
    font-size   : 10px;
    font-weight : 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    color       : rgba(255,255,255,.3);
    border-bottom: 1px solid rgba(255,255,255,.06);
    text-align  : left;
}
.ks-table tbody tr { transition: background .15s; }
.ks-table tbody tr:hover td { background:rgba(255,255,255,.03); }
.ks-table tbody td {
    padding    : 8px 12px;
    color      : rgba(255,255,255,.72);
    border-bottom: 1px solid rgba(255,255,255,.04);
    vertical-align: middle;
}
/* Category row */
.ks-cat-row td {
    padding       : 16px 12px 6px !important;
    font-size     : 10px !important;
    font-weight   : 800 !important;
    text-transform: uppercase !important;
    letter-spacing: .1em !important;
    color         : #818cf8 !important;
    border-bottom : 1px solid rgba(99,102,241,.2) !important;
    background    : none !important;
}
.ks-cat-row:first-child td { padding-top: 8px !important; }

/* KBD keys */
.ks-kbd {
    display       : inline-flex; align-items:center; justify-content:center;
    background    : linear-gradient(180deg,rgba(255,255,255,.1),rgba(255,255,255,.05));
    border        : 1px solid rgba(255,255,255,.18);
    border-bottom : 2px solid rgba(255,255,255,.25);
    border-radius : 6px;
    padding       : 2px 8px;
    font-family   : 'Inter', ui-monospace, monospace;
    font-size     : 11px;
    font-weight   : 600;
    color         : #f0f4ff;
    white-space   : nowrap;
    box-shadow    : 0 2px 4px rgba(0,0,0,.3);
    letter-spacing: .01em;
}
.ks-kbd-sm { padding:1px 5px; font-size:10px; }

.ks-action { color:rgba(255,255,255,.65); }

/* Footer */
.ks-footer {
    display        : flex;
    align-items    : center;
    justify-content: space-between;
    padding        : 14px 28px 18px;
    border-top     : 1px solid rgba(255,255,255,.06);
    flex-shrink    : 0;
    gap            : 12px;
}
.ks-tip { font-size:11px; color:rgba(255,255,255,.28); display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.ks-btn-close {
    background   : linear-gradient(135deg,#6366f1,#8b5cf6);
    color        : #fff;
    border       : none;
    border-radius: 10px;
    padding      : 8px 22px;
    font-size    : 13px;
    font-weight  : 700;
    cursor       : pointer;
    box-shadow   : 0 4px 14px rgba(99,102,241,.35);
    transition   : all .2s;
    flex-shrink  : 0;
}
.ks-btn-close:hover { transform:translateY(-1px); box-shadow:0 6px 20px rgba(99,102,241,.5); }

/* Hidden rows */
.ks-hidden { display:none; }

/* Responsive */
@media(max-width:560px) {
    .ks-modal { border-radius:0; max-height:100vh; width:100%; }
    .ks-overlay { padding:0; }
    .ks-header, .ks-body, .ks-footer { padding-left:16px; padding-right:16px; }
    .ks-search-bar { margin-left:16px; margin-right:16px; }
}
</style>`;
    }

    // ─── MODAL OPEN / CLOSE ──────────────────────────────────────────────────
    function openShortcutsModal() {
        let modal = document.getElementById('editorShortcutsModal');
        if (!modal) {
            document.body.insertAdjacentHTML('beforeend', _buildModalHTML());
            modal = document.getElementById('editorShortcutsModal');
        }
        modal.classList.add('ks-open');
        setTimeout(() => { const s = document.getElementById('ksSearch'); if (s) s.focus(); }, 50);
    }

    function closeShortcutsModal() {
        const modal = document.getElementById('editorShortcutsModal');
        if (modal) modal.classList.remove('ks-open');
    }

    function filterShortcuts(query) {
        const q   = (query || '').toLowerCase().trim();
        const rows = document.querySelectorAll('#ksTableBody tr');
        let lastCatRow = null;
        let visibleInCat = 0;

        rows.forEach(row => {
            if (row.classList.contains('ks-cat-row')) {
                if (lastCatRow && visibleInCat === 0) lastCatRow.classList.add('ks-hidden');
                lastCatRow = row;
                visibleInCat = 0;
                row.classList.remove('ks-hidden');
            } else {
                const text = row.textContent.toLowerCase();
                if (!q || text.includes(q)) {
                    row.classList.remove('ks-hidden');
                    visibleInCat++;
                } else {
                    row.classList.add('ks-hidden');
                }
            }
        });
        if (lastCatRow && visibleInCat === 0) lastCatRow.classList.add('ks-hidden');
    }

    // Expose globally for onclick= handlers
    window.openShortcutsModal  = openShortcutsModal;
    window.closeShortcutsModal = closeShortcutsModal;
    window.filterShortcuts     = filterShortcuts;

    // Esc to close
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeShortcutsModal();
    });

})();
