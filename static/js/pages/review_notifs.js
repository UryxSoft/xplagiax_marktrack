/**
 * review_notifs.js
 * Handles the notification bell and real-time syncing via Socket.IO
 * for student activity in the Document Review interface.
 */

(function () {
    'use strict';

    const STUDENT_TYPES = 'section_edited,comment_resolved,document_complete,feedback_requested';
    let isOpen = false;

    function csrfTok() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function notifIcon(type) {
        const svgs = {
            section_edited: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
            comment_resolved: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
            document_complete: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
            feedback_requested: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        };
        return svgs[type] || '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    }

    function updateBadge(count) {
        const b = document.getElementById('reviewNotifBadge');
        if (!b) return;
        if (count > 0) {
            b.textContent = count > 99 ? '99+' : count;
            b.style.display = 'block';
        } else {
            b.style.display = 'none';
        }
    }

    function renderList(notifs) {
        const list = document.getElementById('reviewNotifList');
        if (!list) return;
        if (!notifs.length) {
            list.innerHTML = '<div style="padding:24px;text-align:center;font-size:12px;color:rgba(255,255,255,.35);">No student activity yet</div>';
            return;
        }
        list.innerHTML = notifs.map(n => {
            return `<div class="review-notif-item${n.read ? '' : ' unread'}" data-id="${n.id}" onclick="openReviewNotif(${n.id},'${(n.url || '').replace(/'/g, "\\'")}')">
                <div class="review-notif-icon type-${esc(n.type)}">${notifIcon(n.type)}</div>
                <div class="review-notif-body">
                    <div class="review-notif-title">${esc(n.title)}</div>
                    <div class="review-notif-msg">${esc(n.message)}</div>
                    <div class="review-notif-time">${esc(n.time_ago || '')}</div>
                </div>
                ${!n.read ? '<div class="review-notif-dot"></div>' : ''}
            </div>`;
        }).join('');
    }

    function loadNotifs() {
        fetch('/notifications/dropdown?types=' + STUDENT_TYPES)
            .then(r => r.json())
            .then(d => {
                updateBadge(d.unread_count || 0);
                renderList(d.notifications || []);
            })
            .catch(() => { });
    }

    window.toggleReviewNotifs = function (e) {
        if (e) e.stopPropagation();
        const dd = document.getElementById('reviewNotifDropdown');
        if (!dd) return;
        isOpen = !isOpen;
        dd.style.display = isOpen ? 'block' : 'none';
        if (isOpen) loadNotifs();
    };

    window.openReviewNotif = function (id, url) {
        const item = document.querySelector(`.review-notif-item[data-id="${id}"]`);
        if (item && item.classList.contains('unread')) {
            fetch('/notifications/' + id + '/read', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrfTok(), 'Content-Type': 'application/json' }
            }).then(() => {
                item.classList.remove('unread');
                const dot = item.querySelector('.review-notif-dot');
                if (dot) dot.remove();
                const b = document.getElementById('reviewNotifBadge');
                if (b) {
                    const n = Math.max(0, parseInt(b.textContent || '0') - 1);
                    if (n <= 0) b.style.display = 'none';
                    else b.textContent = n;
                }
            });
        }
        const dd = document.getElementById('reviewNotifDropdown');
        if (dd) dd.style.display = 'none';
        isOpen = false;
        if (url) window.open(url, '_blank');
    };

    window.markAllReviewRead = function (e) {
        if (e) e.stopPropagation();
        document.querySelectorAll('.review-notif-item.unread').forEach(el => {
            el.classList.remove('unread');
            const dot = el.querySelector('.review-notif-dot');
            if (dot) dot.remove();
        });
        updateBadge(0);
        fetch('/notifications/read-all', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrfTok(), 'Content-Type': 'application/json' }
        }).catch(() => { });
    };

    // Close on outside click
    document.addEventListener('click', e => {
        if (!document.getElementById('reviewNotifWrapper')?.contains(e.target)) {
            const dd = document.getElementById('reviewNotifDropdown');
            if (dd) dd.style.display = 'none';
            isOpen = false;
        }
    });

    // Initial load
    document.addEventListener('DOMContentLoaded', loadNotifs);

    // Socket.IO Integration
    let socket;
    try {
        if (typeof io !== 'undefined') {
            socket = io({ transports: ['polling', 'websocket'], reconnectionAttempts: 3 });
            socket.on('connect', () => {
                console.log('[ReviewNotif] Socket connected');
                socket.emit('notification:join');
            });
            socket.on('notification:new', data => {
                if (data && (!STUDENT_TYPES || STUDENT_TYPES.includes(data.type))) loadNotifs();
            });
            socket.on('notification:count_update', data => {
                if (data && typeof data.count !== 'undefined') updateBadge(data.count);
            });
        }
    } catch (e) {
        console.warn('[ReviewNotif] Socket.IO init failed:', e);
    }

    setInterval(loadNotifs, 60000);

})();
