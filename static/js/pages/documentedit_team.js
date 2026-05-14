/**
 * documentedit_team.js
 * Handles the collaborators list rendering for the document review dashboard.
 */

(function() {
    'use strict';

    const DOC_ID      = Number(window.MT_DATA?.id);
    const OWNER_EMAIL = window.MT_DATA?.invitation?.email;
    const OWNER_NAME  = window.MT_DATA?.invitation?.name;

    const COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316'];
    const roleLabels = { owner: 'Owner', editor: 'Editor', collaborator: 'Collaborator', reader: 'Reader' };

    function csrf() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') : '';
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function colorFor(uid) { 
        return COLORS[(uid || 0) % COLORS.length]; 
    }

    function renderCollabs(collabs) {
        const list = document.getElementById('collabList');
        if (!list) return;

        function memberRow(name, email, roleLabel, badgeHtml, colorSeed) {
            const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
            const color    = colorFor(colorSeed);
            return `
            <div class="team-collab-item">
                <div class="team-avatar" style="background:${color}">${initials}</div>
                <div class="team-collab-info" style="min-width:0;">
                    <span class="team-collab-name">${esc(name)}</span>
                    <span style="font-size:11px;color:rgba(255,255,255,0.45);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(email)}</span>
                    ${badgeHtml}
                </div>
                <span style="font-size:11px;color:rgba(255,255,255,0.45);white-space:nowrap;flex-shrink:0;">${esc(roleLabel)}</span>
            </div>`;
        }

        const rows = [];

        // ── Owner row
        if (OWNER_EMAIL) {
            rows.push(memberRow(OWNER_NAME || OWNER_EMAIL, OWNER_EMAIL, 'Owner', '<span class="team-badge team-badge-ok">Active</span>', 0));
        }

        // ── Collaborators
        collabs.forEach((c, i) => {
            const name      = c.user_name || c.user_email || 'User';
            const email     = c.user_email || '';
            const label     = roleLabels[c.role] || c.role || '';
            const badge     = c.accepted ? '<span class="team-badge team-badge-ok">Active</span>' : '<span class="team-badge team-badge-pending">Pending</span>';
            rows.push(memberRow(name, email, label, badge, c.user_id || (i + 1)));
        });

        if (!rows.length) {
            list.innerHTML = '<div class="team-empty">No members yet.</div>';
            return;
        }
        list.innerHTML = rows.join('');
    }

    function loadCollabs() {
        const list = document.getElementById('collabList');
        if (list) list.innerHTML = '<div class="team-loading">Loading…</div>';

        fetch(`/api/documents/${DOC_ID}/collaborators`, {
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(r => r.json())
        .then(data => {
            renderCollabs(data.collaborators || []);
        })
        .catch(() => {
            if (list) list.innerHTML = '<div class="team-error">Failed to load collaborators.</div>';
        });
    }

    // Initialize on tab click
    document.addEventListener('DOMContentLoaded', () => {
        const teamTabBtn = document.getElementById('teamTab');
        if (teamTabBtn) {
            teamTabBtn.addEventListener('click', () => {
                loadCollabs();
            });
        }
    });

})();
