/**
 * invite_presence.js
 * Real-time presence and basic Socket.IO integration for the Student View
 */

(function () {
    'use strict';

    function init() {
        var DOC_ID = window.DOCUMENT_ID;
        if (!DOC_ID) return;
        if (typeof io === 'undefined') return;

        // ── Color palette for presence avatars ───────────────────────────────
        var COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316'];
        function colorFor(userId) { return COLORS[userId % COLORS.length]; }

        // ── Presence state ───────────────────────────────────────────────────
        var peers = {}; 

        function renderPresence() {
            var bar = document.getElementById('presenceBar');
            if (!bar) return;
            var html = '';
            Object.keys(peers).forEach(function (uid) {
                var p = peers[uid];
                html += '<div class="presence-avatar" style="background:' + colorFor(parseInt(uid)) + '" title="' + escHtml(p.user_name) + '">' + escHtml(p.initials) + '</div>';
            });
            bar.innerHTML = html;
        }

        function escHtml(s) {
            return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        // ── Connect & join doc room ──────────────────────────────────────────
        var socket;
        try {
            socket = io({ transports: ['polling', 'websocket'], reconnectionAttempts: 3 });
        } catch (e) { return; }

        if (!socket || !socket.on) return;

        window._docSocket = socket;

        socket.on('connect', function () {
            console.log('[Presence] Socket connected! ID:', socket.id);
            socket.emit('notification:join');
            socket.emit('doc:join', { doc_id: DOC_ID });
            console.log('[Presence] Joined doc room:', DOC_ID);
        });

        socket.on('doc:user_joined', function (data) {
            if (!data || !data.user_id) return;
            peers[data.user_id] = { user_name: data.user_name, initials: data.initials || '?' };
            renderPresence();
        });

        socket.on('doc:user_left', function (data) {
            if (!data || !data.user_id) return;
            delete peers[data.user_id];
            renderPresence();
        });

        // Basic toast notification
        socket.on('notification:new', function (data) {
            if (data && data.priority === 1) {
                var t = document.getElementById('toast');
                if (t) {
                    t.textContent = data.title || 'New notification';
                    t.className = 'toast toast-show';
                    setTimeout(function () { t.className = 'toast'; }, 4000);
                }
            }
        });

        window.addEventListener('beforeunload', function () {
            try { socket.emit('doc:leave', { doc_id: DOC_ID }); } catch (e) {}
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
