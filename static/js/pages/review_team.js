/**
 * review_team.js
 * Handles the collaborator list rendering for the Document Review interface.
 */

(function () {
    'use strict';

    function waitForConfig(cb) {
        if (window.REVIEW_CONFIG) cb(window.REVIEW_CONFIG);
        else setTimeout(() => waitForConfig(cb), 100);
    }

    waitForConfig(function (config) {
        const DOC_ID = config.documentId;
        const OWNER_EMAIL = config.student.email;
        const OWNER_NAME = config.student.name;

        const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#f97316'];
        function colorFor(uid) { return COLORS[(uid || 0) % COLORS.length]; }

        function esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function memberRow(name, email, roleLabel, badgeHtml, colorSeed) {
            const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
            const color = colorFor(colorSeed);
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

        function renderCollabs(collabs) {
            const list = document.getElementById('collabList');
            if (!list) return;

            const roleLabels = { owner: 'Owner', editor: 'Editor', collaborator: 'Collaborator', reader: 'Reader' };
            const rows = [];

            // Owner row
            if (OWNER_EMAIL) {
                rows.push(memberRow(OWNER_NAME || OWNER_EMAIL, OWNER_EMAIL, 'Owner', '<span class="team-badge team-badge-ok">Active</span>', 0));
            }

            // Other collaborators
            collabs.forEach((c, i) => {
                const name = c.user_name || c.user_email || 'User';
                const roleLabel = roleLabels[c.role] || c.role || '';
                const badge = c.accepted ? '<span class="team-badge team-badge-ok">Active</span>' : '<span class="team-badge team-badge-pending">Pending</span>';
                rows.push(memberRow(name, c.user_email || '', roleLabel, badge, c.user_id || (i + 1)));
            });

            if (!rows.length) {
                list.innerHTML = '<div class="team-empty">No members yet.</div>';
                return;
            }
            list.innerHTML = rows.join('');
        }

        function loadCollabs() {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
            fetch('/api/documents/' + DOC_ID + '/collaborators', {
                headers: { 'X-CSRFToken': csrf }
            })
                .then(r => r.json())
                .then(data => {
                    renderCollabs(data.collaborators || []);
                })
                .catch(() => { });
        }

        document.addEventListener('DOMContentLoaded', () => {
            const teamTabBtn = document.getElementById('teamTab');
            if (teamTabBtn) {
                teamTabBtn.addEventListener('click', loadCollabs);
            }
        });

        // Export if needed
        window.ReviewTeam = { loadCollabs };
    });

})();
