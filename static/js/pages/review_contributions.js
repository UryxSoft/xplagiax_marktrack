/**
 * static/js/pages/review_contributions.js
 * 
 * Fetches and renders the collaboration contribution breakdown
 * in the review.html Overview tab (#overview).
 * 
 * Expects: window.REVIEW_DOC_ID to be set by review_core.js
 * Renders into: #collabContributions (injected into #overview tab)
 */

(function () {
    'use strict';

    function init() {
        const DOC_ID = window.REVIEW_DOC_ID || window.DOCUMENT_ID;
        if (!DOC_ID) return;

        loadContributions(DOC_ID);
    }

    function csrf() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.content : '';
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function loadContributions(docId) {
        const container = document.getElementById('collabContributions');
        if (!container) return;

        fetch('/api/documents/' + docId + '/contributions/summary', {
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            renderContributions(container, data);
        })
        .catch(function () {
            container.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.3);padding:8px 0;">Could not load contribution data.</div>';
        });
    }

    function renderContributions(container, data) {
        const contributors = (data && data.contributors) || [];
        const totalAdded   = data.total_words_added || 0;

        if (!contributors.length) {
            container.innerHTML = [
                '<div class="collab-contrib-empty">',
                '  <i style="font-size:20px;opacity:0.3;">✍</i>',
                '  <div style="font-size:12px;color:rgba(255,255,255,0.3);margin-top:6px;">No contribution data yet.</div>',
                '</div>'
            ].join('');
            return;
        }

        const rows = contributors.map(function (c, i) {
            const pct     = c.percentage || 0;
            const color   = c.color || '#6366f1';
            const name    = esc(c.user_name || 'User');
            const initials = name.replace(/&amp;/g, '&').split(' ')
                              .map(function (w) { return w[0] || ''; })
                              .join('').toUpperCase().slice(0, 2);
            const lastSeen = c.last_active
                ? new Date(c.last_active).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : '—';

            return [
                '<div class="collab-contrib-row">',
                '  <div class="collab-contrib-avatar" style="background:' + color + ';">' + initials + '</div>',
                '  <div class="collab-contrib-info">',
                '    <div class="collab-contrib-name">' + name + '</div>',
                '    <div class="collab-contrib-bar-wrap">',
                '      <div class="collab-contrib-bar" style="width:' + pct + '%;background:' + color + ';"></div>',
                '    </div>',
                '    <div class="collab-contrib-meta">',
                '      <span class="collab-contrib-pct">' + pct.toFixed(1) + '%</span>',
                '      <span class="collab-contrib-words">' + c.words_added + ' words added</span>',
                '      <span class="collab-contrib-date">Last active: ' + lastSeen + '</span>',
                '    </div>',
                '  </div>',
                '</div>'
            ].join('');
        });

        container.innerHTML = [
            '<div class="collab-contrib-header">',
            '  <span>Collaboration Breakdown</span>',
            '  <span class="collab-contrib-total">' + totalAdded + ' total words</span>',
            '</div>',
            '<div class="collab-contrib-list">',
            rows.join(''),
            '</div>'
        ].join('');
    }

    // Initialize on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
