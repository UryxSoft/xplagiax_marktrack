/**
 * invite_notifs.js
 * Student notification dropdown logic for Invite View
 */

(function () {
    'use strict';
    var open = false;

    function init() {
        // Initial badge load + poll every 30s
        loadNotifs();
        setInterval(loadNotifs, 30000);

        // Close on outside click
        document.addEventListener('click', function(e) {
            var wrapper = document.getElementById('inviteNotifWrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                var dd = document.getElementById('inviteNotifDropdown');
                if (dd) dd.style.display = 'none';
                open = false;
            }
        });
    }

    function csrf() { return (typeof window.csrfToken === 'function') ? window.csrfToken() : ''; }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function notifIcon(type) {
        var svgs = {
            comment_added:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            mention:          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
            comment_resolved: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
            collaboration_invite: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        };
        return svgs[type] || '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    }

    function updateBadge(count) {
        var b = document.getElementById('inviteNotifBadge');
        if (!b) return;
        if (count > 0) { b.textContent = count > 99 ? '99+' : count; b.style.display = 'block'; }
        else { b.style.display = 'none'; }
    }

    function renderList(notifs) {
        var list = document.getElementById('inviteNotifList');
        if (!list) return;
        if (!notifs.length) {
            list.innerHTML = '<div style="padding:24px;text-align:center;font-size:12px;color:rgba(255,255,255,.35);">No notifications</div>';
            return;
        }
        list.innerHTML = notifs.map(function(n) {
            var cid = (n.metadata && n.metadata.comment_id) ? n.metadata.comment_id : '';
            return '<div class="invite-notif-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '" onclick="window.openInviteNotif(' + n.id + ',\'' + (n.url || '').replace(/'/g,"\\'") + '\',\'' + n.type + '\',\'' + cid + '\')">'
                + '<div class="invite-notif-icon type-' + esc(n.type) + '">' + notifIcon(n.type) + '</div>'
                + '<div class="invite-notif-body">'
                +   '<div class="invite-notif-title">' + esc(n.title) + '</div>'
                +   '<div class="invite-notif-msg">'   + esc(n.message) + '</div>'
                +   '<div class="invite-notif-time">'  + esc(n.time_ago || '') + '</div>'
                + '</div>'
                + (!n.read ? '<div class="invite-notif-dot"></div>' : '')
                + '</div>';
        }).join('');
    }

    const PROFESSOR_TYPES = 'comment_added,comment_replied,mention';

    function loadNotifs() {
        if (!window.DOCUMENT_ID) return;
        fetch('/notifications/dropdown?types=' + PROFESSOR_TYPES)
            .then(function(r) { return r.json(); })
            .then(function(d) {
                updateBadge(d.unread_count || 0);
                renderList(d.notifications || []);
            })
            .catch(function() {});
    }

    window.toggleInviteNotifs = function(e) {
        if (e) e.stopPropagation();
        var dd = document.getElementById('inviteNotifDropdown');
        if (!dd) return;
        open = !open;
        dd.style.display = open ? 'block' : 'none';
        if (open) loadNotifs();
    };

    window.openInviteNotif = function(id, url, type, commentId) {
        console.log('openInviteNotif called (simplified):', {id:id, url:url});
        
        var item = document.querySelector('.invite-notif-item[data-id="' + id + '"]');
        if (item && item.classList.contains('unread')) {
            fetch('/notifications/' + id + '/read', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' }
            }).then(function() {
                item.classList.remove('unread');
                var dot = item.querySelector('.invite-notif-dot');
                if (dot) dot.remove();
            });
        }

        if (url && url !== '#' && url !== window.location.pathname) {
            window.location.href = url;
        }
    };

    var currentTab = 'all';
    var allNotifs = [];

    window.setNotifTab = function(tab) {
        currentTab = tab;
        document.querySelectorAll('.mt-modal-tab').forEach(function(t) {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        renderModalList();
    };

    function renderModalList() {
        var listContainer = document.getElementById('allNotifsModalList');
        if (!listContainer) return;

        var filtered = allNotifs;
        if (currentTab === 'unread') filtered = allNotifs.filter(function(n) { return !n.read; });
        if (currentTab === 'mentions') filtered = allNotifs.filter(function(n) { return n.type === 'mention'; });

        if (!filtered.length) {
            listContainer.innerHTML = '<div style="padding:60px 20px;text-align:center;color:rgba(255,255,255,0.2);">'
                + '<i data-lucide="bell-off" style="width:48px;height:48px;margin-bottom:16px;opacity:0.5;"></i>'
                + '<div style="font-size:14px;">No notifications found here.</div>'
                + '</div>';
            if (window.lucide) lucide.createIcons();
            return;
        }

        listContainer.innerHTML = filtered.map(function(n) {
            var cid = (n.metadata && n.metadata.comment_id) ? n.metadata.comment_id : '';
            return '<div class="modal-notif-item' + (n.read ? '' : ' unread') + '" data-id="' + n.id + '" onclick="window.closeAllNotifsModal(); window.openInviteNotif(' + n.id + ',\'' + (n.url || '').replace(/'/g,"\\'") + '\',\'' + n.type + '\',\'' + cid + '\')">'
                + '<div class="modal-notif-icon">' + notifIcon(n.type) + '</div>'
                + '<div class="modal-notif-content">'
                +   '<div class="modal-notif-title">' + esc(n.title) + '</div>'
                +   '<div class="modal-notif-msg">'   + esc(n.message) + '</div>'
                +   '<div class="modal-notif-time">'  + esc(n.time_ago || '') + '</div>'
                + '</div>'
                + (!n.read ? '<div class="modal-notif-dot"></div>' : '')
                + '</div>';
        }).join('');
        
        if (window.lucide) lucide.createIcons();
    }

    window.openAllNotifsModal = function(e) {
        console.log('openAllNotifsModal called');
        if (e) e.preventDefault();
        
        var dd = document.getElementById('inviteNotifDropdown');
        if (dd) dd.style.display = 'none';
        open = false;

        var modal = document.getElementById('allNotifsModal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        // Small delay to allow CSS transition
        setTimeout(function() {
            modal.style.opacity = '1';
            var content = modal.querySelector('.mt-modal-content');
            if (content) content.style.transform = 'translateY(0)';
        }, 10);

        var listContainer = document.getElementById('allNotifsModalList');
        if (listContainer) {
            listContainer.innerHTML = '<div style="padding:60px 20px;text-align:center;color:rgba(255,255,255,.3);font-size:14px;">'
                + '<div class="loader-spinner" style="width:24px;height:24px;border:2px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;margin:0 auto 12px;animation:spin 0.8s linear infinite;"></div>'
                + 'Loading your notifications...</div>';
            
            fetch('/notifications/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                allNotifs = data.notifications || [];
                renderModalList();
            })
            .catch(function(err) {
                listContainer.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;font-size:13px;">Error loading notifications.</div>';
            });
        }
        if (window.lucide) lucide.createIcons();
    };

    window.closeAllNotifsModal = function() {
        var modal = document.getElementById('allNotifsModal');
        if (!modal) return;
        
        modal.style.opacity = '0';
        var content = modal.querySelector('.mt-modal-content');
        if (content) content.style.transform = 'translateY(20px)';
        
        setTimeout(function() {
            modal.style.display = 'none';
        }, 300);
    };

    // Add keyframe for spinner
    var style = document.createElement('style');
    style.innerHTML = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);

    window.markAllInviteRead = function(e) {
        if (e) e.stopPropagation();
        function applyReadAll() {
            document.querySelectorAll('.invite-notif-item.unread').forEach(function(el) {
                el.classList.remove('unread');
                var dot = el.querySelector('.invite-notif-dot');
                if (dot) dot.remove();
            });
            updateBadge(0);
        }
        applyReadAll();
        fetch('/notifications/read-all', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' }
        }).catch(function() {});
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
