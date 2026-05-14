/* ═══════════════════════════════════════════════════
   NOTIFICATION CENTER — Vanilla JS
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CSRF = () =>
    document.querySelector('meta[name="csrf-token"]')?.content ||
    window.__CSRF_TOKEN__ || '';

  // ── Estado ──────────────────────────────────────────
  const state = {
    open:          false,
    notifications: [],
    filter:        'all',
    unreadCount:   0,
    stats:         null,
    socket:        null,
    pollTimer:     null,
  };

  // ── Iconos por tipo ──────────────────────────────────
  const ICONS = {
    collaboration_invite:  'user-plus',
    section_edited:        'edit-3',
    section_assigned:      'clipboard',
    team_formed:           'users',
    comment_added:         'message-square',
    comment_replied:       'corner-up-left',
    comment_resolved:      'check-circle',
    feedback_requested:    'help-circle',
    document_complete:     'party-popper',
    review_mode_activated: 'lock',
    deadline_reminder:     'clock',
    badge_awarded:         'award',
    ranking_update:        'trending-up',
    ai_suggestion:         'cpu',
    plagiarism_alert:      'alert-triangle',
    focus_session_long:    'target',
    system_update:         'settings',
    mention:               'at-sign',
    peer_review_invite:    'eye',
    // Shared
    share_received:        'share-2',
  };

  // ── Etiqueta para botón de acción rápida ─────────────
  const QUICK_LABELS = {
    collaboration_invite: 'Accept invitation',
    feedback_requested:   'View document',
    comment_added:        'View comment',
    deadline_reminder:    'Open document',
    share_received:       'View shared',
  };

  // ── Helpers DOM ──────────────────────────────────────
  const $ = id => document.getElementById(id);

  function updateBadge(count) {
    state.unreadCount = count;
    const badge = $('notifBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Toggle dropdown ──────────────────────────────────
  window.notifToggle = function () {
    state.open = !state.open;
    const dropdown = $('notifDropdown');
    if (!dropdown) return;
    dropdown.style.display = state.open ? 'flex' : 'none';
    if (state.open) fetchDropdown();
  };

  // ── Cerrar al click fuera ────────────────────────────
  document.addEventListener('click', function (e) {
    if (!state.open) return;
    const wrapper = $('notifBellWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      state.open = false;
      const dropdown = $('notifDropdown');
      if (dropdown) dropdown.style.display = 'none';
    }
  });

  // ── Filtro ───────────────────────────────────────────
  window.notifSetFilter = function (btn, filter) {
    state.filter = filter;
    document.querySelectorAll('.notif-filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  };

  // ── Fetch dropdown ───────────────────────────────────
  function fetchDropdown() {
    fetch('/notifications/dropdown')
      .then(r => r.json())
      .then(data => {
        state.notifications = data.notifications || [];
        state.stats         = data.stats || null;
        updateBadge(data.unread_count || 0);
        renderList();
        renderStats();
      })
      .catch(() => {});
  }

  function fetchUnreadCount() {
    fetch('/notifications/unread-count')
      .then(r => r.json())
      .then(data => updateBadge(data.count || 0))
      .catch(() => {});
  }

  // ── Render lista ─────────────────────────────────────
  function filteredNotifications() {
    const f = state.filter;
    if (f === 'all')    return state.notifications;
    if (f === 'unread') return state.notifications.filter(n => !n.read);
    return state.notifications.filter(n => n.category === f);
  }

  function renderList() {
    const list = $('notifList');
    if (!list) return;
    const items = filteredNotifications();

    if (items.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications</div>';
      return;
    }

    list.innerHTML = items.map(n => {
      const iconName   = ICONS[n.type] || 'bell';
      const unreadCls  = n.read ? '' : 'unread';
      const criticalCls= n.priority === 1 ? 'critical' : '';
      const dot        = n.read ? '' : '<div class="notif-item-dot"></div>';
      const quickLabel = QUICK_LABELS[n.type];
      const quickBtn   = quickLabel
        ? `<button class="notif-quick-btn"
                   onclick="event.stopPropagation();notifQuickAction(${n.id},'${n.type}','${n.url||''}')"
             >${quickLabel}</button>`
        : '';

      return `
        <div class="notif-item ${unreadCls} ${criticalCls}"
             data-id="${n.id}" data-cat="${n.category}" data-read="${n.read}"
             onclick="notifOpen(${n.id},'${n.url||''}')">
          <div class="notif-item-icon type-${n.type}">
            <i data-lucide="${iconName}"></i>
          </div>
          <div class="notif-item-body">
            <p class="notif-item-title">${escapeHtml(n.title)}</p>
            <p class="notif-item-message">${escapeHtml(n.message)}</p>
            <span class="notif-item-time">${n.time_ago}</span>
            ${quickBtn}
          </div>
          ${dot}
        </div>`;
    }).join('');

    // Instantiate Lucide icons
    if (window.lucide) lucide.createIcons();
  }

  function renderStats() {
    const el = $('notifStats');
    if (!el || !state.stats) return;
    el.textContent = `${state.stats.response_rate}% comments responded this week`;
  }

  // ── Acciones ─────────────────────────────────────────
  window.notifOpen = function (id, url) {
    const notif = state.notifications.find(n => n.id === id);
    if (notif && !notif.read) markRead(id);
    if (url) window.location.href = url;
  };

  function markRead(id) {
    const notif = state.notifications.find(n => n.id === id);
    if (!notif || notif.read) return;
    notif.read = true;
    updateBadge(Math.max(0, state.unreadCount - 1));
    renderList();
    fetch(`/notifications/${id}/read`, {
      method: 'POST',
      headers: { 'X-CSRFToken': CSRF(), 'Content-Type': 'application/json' },
    }).catch(() => {});
  }

  window.notifMarkAllRead = function () {
    fetch('/notifications/read-all', {
      method: 'POST',
      headers: { 'X-CSRFToken': CSRF(), 'Content-Type': 'application/json' },
    }).then(r => r.json()).then(data => {
      if (data.success) {
        state.notifications.forEach(n => { n.read = true; });
        updateBadge(0);
        renderList();
      }
    }).catch(() => {});
  };

  window.notifQuickAction = function (id, type, url) {
    if (type === 'collaboration_invite') {
      const meta = (state.notifications.find(n=>n.id===id)||{}).metadata || {};
      const inviteUrl = meta.invite_url || url;
      if (inviteUrl) window.location.href = inviteUrl;
    } else if (type === 'share_received') {
      // Navigate to shared-to-me filter view
      window.location.href = url || '/?filter=shared-to-me';
    } else if (url) {
      window.location.href = url;
    }
    markRead(id);
  };

  // ── SocketIO ─────────────────────────────────────────
  function connectSocket() {
    if (typeof io === 'undefined') {
      console.warn('[Notifications] Socket.IO library not found. Real-time notifications disabled.');
      return;
    }
    try {
      console.log('[Notifications] Connecting to Socket.IO...');
      const socket = io({ 
        transports: ['websocket', 'polling'], 
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });
      state.socket = socket;

      socket.on('connect', () => {
        console.log('[Notifications] Socket connected! ID:', socket.id);
        socket.emit('notification:join');
      });

      socket.on('connect_error', (err) => {
        console.error('[Notifications] Connection error:', err.message);
      });

      socket.on('notification:new', (data) => {
        console.log('[Notifications] New notification received:', data);
        state.notifications.unshift(data);
        if (state.notifications.length > 20) state.notifications.pop();
        updateBadge(data.unread_count || state.unreadCount + 1);
        if (state.open) renderList();
        showToast(data);
      });

      socket.on('notification:count_update', (data) => {
        console.log('[Notifications] Count update:', data.count);
        updateBadge(data.count || 0);
      });

      socket.on('disconnect', (reason) => {
        console.warn('[Notifications] Socket disconnected:', reason);
      });
    } catch (e) {
      console.error('[Notifications] Failed to initialize Socket.IO:', e);
    }
  }

  // ── Toast para notificaciones críticas ───────────────
  function showToast(notif) {
    if (notif.priority !== 1) return;
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:99999;
      background:var(--notif-bg); border:1px solid var(--notif-critical);
      border-left:4px solid var(--notif-critical);
      border-radius:10px; padding:12px 16px; max-width:320px;
      box-shadow:var(--notif-shadow); cursor:pointer;
      animation: notif-slide-in .2s ease-out;
    `;
    toast.innerHTML = `
      <p style="margin:0 0 2px;font-size:.85rem;font-weight:600;color:var(--notif-text-primary)">${escapeHtml(notif.title)}</p>
      <p style="margin:0;font-size:.78rem;color:var(--notif-text-muted)">${escapeHtml(notif.message)}</p>
    `;
    toast.onclick = () => {
      if (notif.url) window.location.href = notif.url;
      toast.remove();
    };
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // ── XSS-safe ─────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Init ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (window.lucide) lucide.createIcons();
    fetchUnreadCount();
    connectSocket();
    // Polling de respaldo cada 60 s si SocketIO no está disponible
    state.pollTimer = setInterval(fetchUnreadCount, 60000);
  });

})();
