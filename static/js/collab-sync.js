/**
 * static/js/collab-sync.js
 * 
 * Yjs Collaborative Editing Integration for MarkTrack
 * 
 * Architecture:
 *   - One Y.Doc per document session (managed here)
 *   - Y.Text 'content' bound to the single Quill instance from QuillPagination v4
 *   - Transport: Flask-SocketIO (existing socket from invite_presence.js)
 *   - Awareness: y-protocols/awareness for cursors and user presence
 * 
 * Page separation is PRESERVED — Yjs syncs the complete Delta of the single
 * Quill instance; the QuillPagination system renders page-break overlays
 * on top of the single editor, so pagination is a pure visual concern.
 * 
 * Loading: ESM module, loaded via <script type="module"> in invite.html
 *          Only activates when collab mode is enabled (≥2 active collaborators)
 * 
 * Dependencies (CDN, loaded before this module):
 *   - Yjs: https://cdn.jsdelivr.net/npm/yjs@13/+esm
 *   - y-quill: https://cdn.jsdelivr.net/npm/y-quill@0.1/+esm
 *   - y-protocols/awareness: https://cdn.jsdelivr.net/npm/y-protocols@1/awareness.js
 *   - Socket.IO (already loaded by invite.html)
 */

import * as Y from 'https://cdn.jsdelivr.net/npm/yjs@13.6.20/+esm';
import { QuillBinding } from 'https://cdn.jsdelivr.net/npm/y-quill@0.1.5/+esm';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'https://cdn.jsdelivr.net/npm/y-protocols@1.0.6/awareness.js/+esm';

// ── State ──────────────────────────────────────────────────────────────────

const ydoc     = new Y.Doc();
const ytext    = ydoc.getText('content');
let   binding  = null;
let   awareness = null;
let   socket   = null;
let   docId    = null;
let   isSynced = false;

// Flush full state to server every 60s when dirty
let   _stateDirty    = false;
let   _flushInterval = null;

// ── Colors matching CONTRIBUTOR_COLORS from contributions_routes.py ────────
const USER_COLORS = [
    '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
    '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
];
function colorForId(userId) {
    return USER_COLORS[Math.abs(userId) % USER_COLORS.length];
}

// ── Init ───────────────────────────────────────────────────────────────────

function initCollab() {
    // Read config from server-config JSON block (set by invite.html)
    const cfg = window._serverConfig || {};
    docId = cfg.documentId || window.DOCUMENT_ID;
    if (!docId) {
        console.warn('[CollabSync] No DOCUMENT_ID — collaborative mode inactive');
        return;
    }

    // Reuse the socket created by invite_presence.js
    // invite_presence.js sets window._docSocket after connecting
    waitForSocket(function (s) {
        socket = s;
        setupSocketSync();
    });

    // Wait for QuillPagination to be ready
    if (window._paginationQuill) {
        attachBinding(window._paginationQuill);
    } else {
        document.addEventListener('quillPaginationReady', function (e) {
            const quill = e.detail && e.detail.pagination && e.detail.pagination.quill;
            if (quill) attachBinding(quill);
        });
    }
}

function waitForSocket(callback) {
    // If presence socket already exists, use it
    if (window._docSocket) {
        callback(window._docSocket);
        return;
    }
    // Poll every 200ms until available (invite_presence.js initializes it)
    const interval = setInterval(function () {
        if (window._docSocket) {
            clearInterval(interval);
            callback(window._docSocket);
        }
    }, 200);
    // Timeout after 10s
    setTimeout(function () { clearInterval(interval); }, 10000);
}

// ── Quill Binding ──────────────────────────────────────────────────────────

function attachBinding(quill) {
    if (binding) return; // already bound

    // Create QuillBinding: syncs ytext ↔ Quill Delta
    // Page breaks are visual overlays — Quill content is one continuous stream
    binding = new QuillBinding(ytext, quill, awareness);
    console.log('[CollabSync] QuillBinding attached to Quill instance');

    // Mark dirty on any local change (for periodic flush)
    ydoc.on('update', function (update, origin) {
        if (origin === 'local' || origin === null) {
            _stateDirty = true;
        }
    });

    // Expose for debugging
    window._yjsDoc  = ydoc;
    window._yjsText = ytext;
}

// ── SocketIO Transport ─────────────────────────────────────────────────────

function setupSocketSync() {
    if (!socket || !socket.on) return;

    // ── Receive full state sync (on join) ────────────────────────────────
    socket.on('yjs:sync', function (data) {
        if (!data || !data.state) return;
        try {
            const stateBytes = base64ToUint8Array(data.state);
            Y.applyUpdate(ydoc, stateBytes, 'remote');
            isSynced = true;
            console.log('[CollabSync] Initial state applied from server');
        } catch (e) {
            console.warn('[CollabSync] Failed to apply initial state:', e);
        }
    });

    // ── Receive incremental update from peers ────────────────────────────
    socket.on('yjs:update', function (data) {
        if (!data || !data.update) return;
        try {
            const updateBytes = base64ToUint8Array(data.update);
            Y.applyUpdate(ydoc, updateBytes, 'remote');
        } catch (e) {
            console.warn('[CollabSync] Failed to apply peer update:', e);
        }
    });

    // ── Receive awareness update (cursors, presence) ─────────────────────
    socket.on('yjs:awareness', function (data) {
        if (!data || !data.awareness || !awareness) return;
        try {
            const awarenessBytes = base64ToUint8Array(data.awareness);
            applyAwarenessUpdate(awareness, awarenessBytes, 'remote');
        } catch (e) {
            console.warn('[CollabSync] Failed to apply awareness update:', e);
        }
    });

    // ── Send local updates to server ─────────────────────────────────────
    ydoc.on('update', function (update, origin) {
        if (origin === 'remote') return; // don't echo remote updates
        const b64 = uint8ArrayToBase64(update);
        socket.emit('yjs:update', { doc_id: docId, update: b64 });
    });

    // ── Setup Awareness ──────────────────────────────────────────────────
    setupAwareness();

    // ── Request initial state from server ────────────────────────────────
    socket.emit('yjs:sync_request', { doc_id: docId });

    // ── Periodic full-state flush (every 60s) ────────────────────────────
    _flushInterval = setInterval(flushFullState, 60000);

    // ── Flush on page close ──────────────────────────────────────────────
    window.addEventListener('beforeunload', flushFullState);

    console.log('[CollabSync] Socket sync configured for doc', docId);
}

// ── Awareness (Cursors + Presence) ────────────────────────────────────────

function setupAwareness() {
    awareness = new Awareness(ydoc);

    // Set local user state from server-config
    const cfg      = window._serverConfig || {};
    const userName = cfg.studentName || cfg.userName || 'Anonymous';
    const userId   = cfg.userId || 0;
    const color    = colorForId(userId);

    awareness.setLocalStateField('user', {
        name:    userName,
        color:   color,
        userId:  userId,
        initials: userName.split(' ')
                    .map(function (w) { return w[0] || ''; })
                    .join('').toUpperCase().slice(0, 2),
    });

    // Broadcast awareness changes to peers
    awareness.on('update', function (changes) {
        const update = encodeAwarenessUpdate(awareness, Array.from(awareness.getStates().keys()));
        const b64    = uint8ArrayToBase64(update);
        if (socket) {
            socket.emit('yjs:awareness', { doc_id: docId, awareness: b64 });
        }
    });

    // Render remote cursors on awareness change
    awareness.on('change', function () {
        renderCursors();
    });

    // Re-attach binding with awareness now that it's ready
    if (binding) {
        // Rebind with awareness (QuillBinding supports awareness as 3rd arg)
        // Binding already created — awareness updates will flow via the socket events
    }
}

// ── Cursor Rendering ───────────────────────────────────────────────────────

function renderCursors() {
    // Remove existing cursor labels
    document.querySelectorAll('.yjs-cursor').forEach(function (el) { el.remove(); });

    if (!awareness) return;

    const localId = ydoc.clientID;
    awareness.getStates().forEach(function (state, clientId) {
        if (clientId === localId) return;
        if (!state.cursor || !state.user) return;

        const user  = state.user;
        const color = user.color || '#6366f1';
        const name  = user.name  || 'User';

        // Use Quill getBounds to position cursor
        const quill = window._paginationQuill;
        if (!quill) return;

        try {
            const index  = state.cursor.index  || 0;
            const length = state.cursor.length || 0;
            const bounds = quill.getBounds(index, length);
            if (!bounds) return;

            const editorEl  = quill.root;
            const editorRect = editorEl.getBoundingClientRect();

            const label = document.createElement('div');
            label.className = 'yjs-cursor';
            label.style.cssText = [
                'position: absolute',
                'left: ' + (bounds.left + editorEl.offsetLeft) + 'px',
                'top: ' + (bounds.top + editorEl.offsetTop - 20) + 'px',
                'background: ' + color,
                'color: #fff',
                'font-size: 10px',
                'font-weight: 700',
                'padding: 2px 6px',
                'border-radius: 4px',
                'pointer-events: none',
                'z-index: 10',
                'white-space: nowrap',
                'box-shadow: 0 1px 4px rgba(0,0,0,0.3)',
            ].join(';');
            label.textContent = name;

            // Append to the page wrapper for correct positioning
            const wrapper = editorEl.closest('.qp-page') || editorEl.parentElement;
            if (wrapper) {
                wrapper.style.position = 'relative';
                wrapper.appendChild(label);
            }
        } catch (e) {
            // getBounds may fail if index is out of range
        }
    });
}

// ── Full State Flush ───────────────────────────────────────────────────────

function flushFullState() {
    if (!_stateDirty || !socket) return;
    try {
        const state = Y.encodeStateAsUpdate(ydoc);
        const b64   = uint8ArrayToBase64(state);
        // Send full state to server for MySQL persistence
        socket.emit('yjs:update', { doc_id: docId, update: b64, full_state: true });
        _stateDirty = false;
    } catch (e) {
        console.warn('[CollabSync] Failed to flush state:', e);
    }
}

// ── Binary ↔ Base64 Helpers ────────────────────────────────────────────────

function uint8ArrayToBase64(bytes) {
    let binary = '';
    const len  = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(b64) {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ── Entry Point ────────────────────────────────────────────────────────────

// Wait for the page to check collab status before initializing
// This is called after the DOM is ready and DOCUMENT_ID is available
function start() {
    const docIdNow = window.DOCUMENT_ID || (window._serverConfig && window._serverConfig.documentId);
    if (!docIdNow) return;

    // Check if collab mode is enabled for this document
    fetch('/api/documents/' + docIdNow + '/collab-status', {
        credentials: 'include',
        headers: {
            'X-CSRFToken': (document.querySelector('meta[name="csrf-token"]') || {}).content || ''
        }
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data && data.collab_mode_enabled) {
            console.log('[CollabSync] Collab mode active (' + data.active_collaborators + ' collaborators) — initializing Yjs');
            // Show collab active badge in header
            showCollabBadge(data.active_collaborators);
            initCollab();
        } else {
            console.log('[CollabSync] Collab mode inactive — Yjs not initialized');
        }
    })
    .catch(function (e) {
        console.warn('[CollabSync] Could not check collab status:', e);
    });
}

function showCollabBadge(activeCount) {
    const presenceBar = document.getElementById('presenceBar');
    if (!presenceBar) return;
    // Add a subtle "Live" indicator to the presence bar
    const badge = document.createElement('div');
    badge.id    = 'collabActiveBadge';
    badge.className = 'collab-active-badge';
    badge.textContent = '● Live';
    presenceBar.appendChild(badge);
}

// Expose cleanup for debugging
window._collabSync = { ydoc, flushFullState };

// Start after short delay to allow invite_core.js to set window.DOCUMENT_ID
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
} else {
    setTimeout(start, 300);
}
