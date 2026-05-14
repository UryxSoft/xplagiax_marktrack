/**
 * invite_team.js
 * Team side panel logic for Student View
 */

(function () {
    'use strict';

    let collabs = [];
    let MAX_COLLABS = 3;

    function init() {
        // Try to load immediately if ID exists
        if (window.DOCUMENT_ID) {
            loadTeam();
        } else {
            // Wait for invite_core.js to set it
            let retries = 0;
            const checkId = setInterval(function() {
                if (window.DOCUMENT_ID) {
                    clearInterval(checkId);
                    loadTeam();
                } else if (retries++ > 20) {
                    clearInterval(checkId);
                }
            }, 200);
        }

        // Also refresh when panel is toggled
        var header = document.querySelector('.panel-header[data-toggle="teamSidePanel"]');
        if (header) {
            header.addEventListener('click', function () {
                loadTeam();
            });
        }
    }

    function csrf() { return (typeof window.csrfToken === 'function') ? window.csrfToken() : ''; }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316'];
    function colorFor(uid) { return COLORS[uid % COLORS.length]; }

    function loadTeam() {
        const DOC_ID = window.DOCUMENT_ID;
        if (!DOC_ID) return;
        fetch('/api/documents/' + DOC_ID + '/collaborators', {
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            collabs = data.collaborators || [];
            // Enforce server-provided limits (avoid hardcoded MAX_COLLABS desync)
            if (data.limits && data.limits.max) {
                MAX_COLLABS = data.limits.max;
            }
            renderTeam();
            // Also load contribution percentages
            loadContributions(DOC_ID);
        })
        .catch(function() {});
    }

    let collabToRemove = null;

    function renderTeam() {
        var list = document.getElementById('teamSideList');
        var form = document.getElementById('teamSideForm');
        if (!list) return;

        if (!collabs.length) {
            list.innerHTML = '<div style="padding:10px;text-align:center;font-size:12px;color:rgba(255,255,255,0.3);">No collaborators yet.</div>';
        } else {
            list.innerHTML = collabs.map(function(c) {
                var name     = esc(c.user_name || c.user_email || 'User');
                var initials = name.replace(/&amp;/g,'&').split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);
                var color    = colorFor(c.user_id);
                var badge    = c.accepted
                    ? '<span style="font-size:10px;background:rgba(34,197,94,0.18);color:#4ade80;padding:1px 6px;border-radius:9px;">Active</span>'
                    : '<span style="font-size:10px;background:rgba(245,158,11,0.15);color:#fbbf24;padding:1px 6px;border-radius:9px;">Pending</span>';
                
                return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">'
                    + '<div style="width:26px;height:26px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">' + initials + '</div>'
                    + '<div style="flex:1;min-width:0;">'
                    +   '<div style="font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>'
                    + '</div>'
                    + badge
                    + '<button class="btn-icon-small" onclick="openCollabRemoveModal(' + c.id + ', \'' + esc(c.user_email) + '\')" title="Remove" style="padding:4px;background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;transition:color 0.2s;" onmouseover="this.style.color=\'#f87171\'" onmouseout="this.style.color=\'rgba(255,255,255,0.3)\'">'
                    + '<i data-lucide="trash-2" style="width:14px;height:14px;"></i>'
                    + '</button>'
                    + '</div>';
            }).join('');
        }

        if (form) {
            form.style.display = collabs.length >= MAX_COLLABS ? 'none' : 'block';
        }

        if (window.lucide) window.lucide.createIcons();
    }

    // ── Remove Collaborator Logic ──────────────────────────────────────────

    window.openCollabRemoveModal = function(id, email) {
        collabToRemove = id;
        var display = document.getElementById('removeCollabEmailDisplay');
        if (display) display.textContent = email;
        var modal = document.getElementById('collabRemoveBackdrop');
        if (modal) modal.style.display = 'flex';
    };

    window.closeCollabRemoveModal = function() {
        var modal = document.getElementById('collabRemoveBackdrop');
        if (modal) modal.style.display = 'none';
        collabToRemove = null;
    };

    document.getElementById('confirmRemoveCollabBtn').onclick = function() {
        if (!collabToRemove) return;
        
        var btn = this;
        var spinner = document.getElementById('removeCollabSpinner');
        btn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';

        fetch('/api/collaborators/' + collabToRemove, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                showSideMsg('Collaborator removed.', true);
                loadTeam();
                closeCollabRemoveModal();
            } else {
                showSideMsg(data.error || 'Error removing collaborator.', false);
            }
        })
        .catch(function() { showSideMsg('Network error.', false); })
        .finally(function() {
            btn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        });
    };

    window.teamSideInvite = function () {
        var emailEl = document.getElementById('teamSideEmail');
        var roleEl  = document.getElementById('teamSideRole');
        var email   = emailEl ? emailEl.value.trim() : '';
        var role    = roleEl  ? roleEl.value : 'collaborator';

        if (!email) { showSideMsg('Enter an email address.', false); return; }
        if (collabs.length >= MAX_COLLABS) { showSideMsg('Maximum limit reached.', false); return; }
        
        fetch('/api/documents/' + window.DOCUMENT_ID + '/collaborators/invite', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body:    JSON.stringify({ email: email, role: role }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                if (emailEl) emailEl.value = '';
                showSideMsg('Invitation sent.', true);
                loadTeam();
            } else {
                showSideMsg(data.error || 'Error sending invitation.', false);
            }
        })
        .catch(function() { showSideMsg('Network error.', false); });
    };

    function showSideMsg(text, ok) {
        var el = document.getElementById('teamSideMsg');
        if (!el) return;
        el.textContent   = text;
        el.style.background = ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
        el.style.color      = ok ? '#4ade80' : '#f87171';
        el.style.display    = 'block';
        setTimeout(function() { el.style.display = 'none'; }, 3500);
    }

    // ── Contribution Percentages ───────────────────────────────────────────

    function loadContributions(docId) {
        fetch('/api/documents/' + docId + '/contributions/summary', {
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            renderContributions(data);
        })
        .catch(function() {});
    }

    function renderContributions(data) {
        var section = document.getElementById('teamSideContribs');
        if (!section) return;
        var contributors = (data && data.contributors) || [];
        if (!contributors.length) {
            section.innerHTML = '';
            return;
        }

        var html = '<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Contributions</div>';
        contributors.forEach(function(c) {
            var pct   = c.percentage || 0;
            var color = c.color || '#6366f1';
            var name  = esc(c.user_name || 'User');
            html += [
                '<div style="margin-bottom:8px;">',
                '  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">',
                '    <span style="font-size:11px;color:rgba(255,255,255,0.75);">' + name + '</span>',
                '    <span style="font-size:11px;font-weight:700;color:' + color + ';">' + pct.toFixed(1) + '%</span>',
                '  </div>',
                '  <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">',
                '    <div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:2px;transition:width .5s ease;"></div>',
                '  </div>',
                '</div>'
            ].join('');
        });
        section.innerHTML = html;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
