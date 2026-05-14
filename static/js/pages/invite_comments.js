/**
 * invite_comments.js
 * Professor feedback and student validation logic for the Student View
 */

(function () {
    'use strict';

    let cpComments = [];
    let cpValidated = {};
    let cpShowShading = true;

    // Expose to window for other components (like PagesOffcanvas)
    window.cpComments = cpComments;
    window.cpValidated = cpValidated;

    function init() {
        const DOC_ID = window.DOCUMENT_ID;
        if (!DOC_ID) return;

        // Load validated state from localStorage
        try {
            var savedValidated = localStorage.getItem('cpValidated_' + DOC_ID);
            if (savedValidated) cpValidated = JSON.parse(savedValidated);
        } catch(e) {}

        // Load panel when it first expands; reload every 30 s while open
        var cpHeader = document.querySelector('.panel-header[data-toggle="commentsPanel"]');
        if (cpHeader) {
            cpHeader.addEventListener('click', function () {
                var panel = document.getElementById('commentsPanel');
                if (!panel) return;
                setTimeout(function () {
                    if (!panel.classList.contains('collapsed')) {
                        loadCommentsPanel();
                    }
                }, 50);
            });
        }

        setInterval(function () {
            var panel = document.getElementById('commentsPanel');
            if (panel && !panel.classList.contains('collapsed')) {
                loadCommentsPanel();
            }
        }, 30000);
    }

    function csrf() { return (typeof window.csrfToken === 'function') ? window.csrfToken() : ''; }

    function getQuill() {
        if (window.quillPagination && window.quillPagination.pages && window.quillPagination.pages[0]) {
            return window.quillPagination.pages[0].quill;
        }
        return window.quill || null;
    }

    function esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function renderCommentsPanel() {
        var body = document.getElementById('commentsPanelBody');
        if (!body) return;
        // Filter out page-specific comments (they belong to the Pages sidebar session)
        var filtered = cpComments.filter(function(c) { return c.page_index == null; });

        var active = filtered.filter(function(c) { return !c.resolved; });
        var resolved = filtered.filter(function(c) { return c.resolved; });
        var sorted = active.concat(resolved);

        if (!sorted.length) {
            body.innerHTML = '<div class="activity-empty">No comments yet.</div>';
            return;
        }

        body.innerHTML = sorted.map(function(c) {
            var isValidated = !!cpValidated[c.id];
            var dot = '<div class="cp-color-dot" style="background:' + esc(c.color || '#FDE68A') + '"></div>';
            var snippet = c.selectedText
                ? '<div class="cp-snippet">&ldquo;' + esc(c.selectedText.substring(0, 60)) + (c.selectedText.length > 60 ? '…' : '') + '&rdquo;</div>'
                : '';
            
            var mentionHtml = '';
            var mentions = extractMentions(c.text);
            if (mentions.length) {
                mentionHtml = mentions.map(function(m) {
                    return '<span class="cp-mention">@ ' + esc(m) + '</span> ';
                }).join('');
            }

            var statusHtml = '';
            if (c.resolved && isValidated) {
                statusHtml = '<span class="cp-validated-badge">✓ Validated</span>';
            } else if (c.resolved) {
                statusHtml = '<span class="cp-resolved-badge">Resolved</span>';
            }

            var actions = '';
            if (!c.resolved) {
                actions = '<div class="cp-actions">'
                    + '<button class="cp-btn cp-btn-view" onclick="event.stopPropagation(); cpViewInDoc(' + c.id + ',' + (c.selection_from || 0) + ',\'' + esc(c.color || '#FDE68A') + '\')">View in document</button>'
                    + '<button class="cp-btn cp-btn-resolve" onclick="event.stopPropagation(); cpResolve(' + c.id + ',this)">Resolved</button>'
                    + '</div>';
            }

            var validateHtml = '';
            if (c.resolved && window.IS_STUDENT) {
                var cbId = 'cpValidateCb_' + c.id;
                validateHtml = '<div class="cp-validate-row' + (isValidated ? ' validated' : '') + '" onclick="event.stopPropagation(); cpToggleValidation(' + c.id + ');">'
                    + '<input type="checkbox" class="cp-validate-cb" id="' + cbId + '"' + (isValidated ? ' checked' : '') + ' onclick="event.stopPropagation(); cpToggleValidation(' + c.id + ');" />'
                    + '<label class="cp-validate-label" for="' + cbId + '" onclick="event.stopPropagation();">' + (isValidated ? 'Correction validated' : 'Validate correction') + '</label>'
                    + '</div>';
            }

            var cardClasses = 'cp-card';
            if (c.resolved) cardClasses += ' cp-resolved';
            if (c.resolved && isValidated) cardClasses += ' cp-validated';

            var cardClick = (c.selection_from != null && c.selection_to != null)
                ? ' onclick="window.cpFlashHighlight(' + c.id + ')"'
                : '';

            return '<div class="' + cardClasses + '" id="cp-card-' + c.id + '"' + cardClick + '>'
                + '<div class="cp-card-top">' + dot + '<span class="cp-author">' + esc(c.author_name) + '</span><span class="cp-time">' + esc(c.time_ago || '') + '</span></div>'
                + snippet
                + mentionHtml
                + statusHtml
                + '<div class="cp-text">' + esc(c.text) + '</div>'
                + actions
                + validateHtml
                + '</div>';
        }).join('');
    }

    function extractMentions(text) {
        var matches = [];
        var re = /@([\w.\-]+(?:\s[\w.\-]+)?)/g;
        var m;
        while ((m = re.exec(text || '')) !== null) { matches.push(m[1]); }
        return matches;
    }

    function loadCommentsPanel() {
        const DOC_ID = window.DOCUMENT_ID;
        return fetch('/api/documents/' + DOC_ID + '/comments', {
            headers: { 'X-CSRFToken': csrf() }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.comments) {
                cpComments = data.comments;
                window.cpComments = cpComments;
                renderCommentsPanel();
                waitForQuillCp(function(q) { applyCommentHighlights(q); });
                // Notify other components
                if (window.PagesOffcanvas && window.PagesOffcanvas.refresh) {
                    window.PagesOffcanvas.refresh();
                }
            }
        })
        .catch(function() {});
    }

    function waitForQuillCp(cb) {
        var q = getQuill();
        if (q) { cb(q); return; }
        setTimeout(function() { waitForQuillCp(cb); }, 400);
    }

    function applyCommentHighlights(q) {
        // First clear any existing highlights if we are turning them off
        if (!cpShowShading) {
            cpComments.forEach(function(c) {
                if (c.selection_from != null && c.selection_to != null) {
                    var len = Math.max(1, c.selection_to - c.selection_from);
                    try {
                        var wasEnabled = q.isEnabled();
                        if (!wasEnabled) q.enable();
                        q.formatText(c.selection_from, len, { background: false }, 'api');
                        if (!wasEnabled) q.disable();
                    } catch(e) {}
                }
            });
            return;
        }

        cpComments.forEach(function(c) {
            if (c.resolved && cpValidated[c.id]) return;
            if (c.resolved) return;
            if (c.selection_from == null || c.selection_to == null) return;
            var len = Math.max(1, c.selection_to - c.selection_from);
            try {
                var wasEnabled = q.isEnabled();
                if (!wasEnabled) q.enable();
                q.formatText(c.selection_from, len, { background: c.color || '#FDE68A' }, 'api');
                if (!wasEnabled) q.disable();
            } catch(e) {}
        });
    }

    function cpRemoveHighlight(c) {
        if (!c || c.selection_from == null || c.selection_to == null) return;
        var q = getQuill();
        if (!q) return;
        var len = Math.max(1, c.selection_to - c.selection_from);
        try {
            var wasEnabled = q.isEnabled();
            if (!wasEnabled) q.enable();
            q.formatText(c.selection_from, len, { background: false }, 'api');
            if (!wasEnabled) q.disable();
        } catch(e) {}
    }

    window.cpFlashHighlight = function(id) {
        var c = cpComments.find(function(x) { return x.id === id; });
        if (!c || c.selection_from == null || c.selection_to == null) return;
        var q = getQuill();
        if (!q) return;
        var from = c.selection_from;
        var len = Math.max(1, (c.selection_to || from + 1) - from);
        var hlColor = c.color || '#FDE68A';

        try {
            var wasEnabled = q.isEnabled();
            if (!wasEnabled) q.enable();
            q.formatText(from, len, { background: hlColor }, 'api');
            if (!wasEnabled) q.disable();

            var bounds = q.getBounds(from, len);
            var editorEl = q.root || document.querySelector('.ql-editor');
            if (editorEl && bounds) {
                var scrollTarget = editorEl.scrollTop + bounds.top - (editorEl.clientHeight / 2);
                editorEl.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
            }

            setTimeout(function() {
                try {
                    var w = q.isEnabled();
                    if (!w) q.enable();
                    q.formatText(from, len, { background: '#ffffff' }, 'api');
                    if (!w) q.disable();
                    setTimeout(function() {
                        try {
                            var w2 = q.isEnabled();
                            if (!w2) q.enable();
                            q.formatText(from, len, { background: hlColor }, 'api');
                            if (!w2) q.disable();
                            setTimeout(function() {
                                try {
                                    var w3 = q.isEnabled();
                                    if (!w3) q.enable();
                                    q.formatText(from, len, { background: false }, 'api');
                                    if (!w3) q.disable();
                                } catch(e) {}
                            }, 1500);
                        } catch(e) {}
                    }, 200);
                } catch(e) {}
            }, 400);
        } catch(e) {}
    };

    window.cpViewInDoc = function(id, from, color) {
        var q = getQuill();
        if (!q) return;
        var c = cpComments.find(function(x) { return x.id === id; });
        if (!c) return;
        var len = Math.max(1, (c.selection_to || from + 1) - from);
        var hlColor = c.color || color || '#FDE68A';

        try {
            var wasEnabled = q.isEnabled();
            if (!wasEnabled) q.enable();
            q.formatText(from, len, { background: hlColor }, 'api');
            if (!wasEnabled) q.disable();

            var bounds = q.getBounds(from, len);
            var editorEl = q.root || document.querySelector('.ql-editor');
            if (editorEl && bounds) {
                var scrollTarget = editorEl.scrollTop + bounds.top - (editorEl.clientHeight / 2);
                editorEl.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
            }

            setTimeout(function() {
                try {
                    var w = q.isEnabled();
                    if (!w) q.enable();
                    q.formatText(from, len, { background: '#ffffff' }, 'api');
                    if (!w) q.disable();
                    setTimeout(function() {
                        try {
                            var w2 = q.isEnabled();
                            if (!w2) q.enable();
                            q.formatText(from, len, { background: hlColor }, 'api');
                            if (!w2) q.disable();
                        } catch(e) {}
                    }, 200);
                } catch(e) {}
            }, 400);
        } catch(e) {}
    };

    window.cpToggleValidation = function(id) {
        var c = cpComments.find(function(x) { return x.id === id; });
        if (!c || !c.resolved) return;

        if (cpValidated[id]) {
            delete cpValidated[id];
            if (c.selection_from != null && c.selection_to != null) {
                var q = getQuill();
                if (q) {
                    var len = Math.max(1, c.selection_to - c.selection_from);
                    try {
                        var wasEnabled = q.isEnabled();
                        if (!wasEnabled) q.enable();
                        q.formatText(c.selection_from, len, { background: c.color || '#FDE68A' }, 'api');
                        if (!wasEnabled) q.disable();
                    } catch(e) {}
                }
            }
        } else {
            cpValidated[id] = true;
            cpRemoveHighlight(c);
        }

        try { localStorage.setItem('cpValidated_' + window.DOCUMENT_ID, JSON.stringify(cpValidated)); } catch(e) {}
        renderCommentsPanel();
    };

    window.cpToggleShading = function() {
        cpShowShading = !cpShowShading;
        
        // Update UI button state
        var btn = document.getElementById('cpToggleShadingBtn');
        if (btn) {
            btn.classList.toggle('active', !cpShowShading);
            btn.innerHTML = cpShowShading ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
            if (window.lucide) lucide.createIcons();
        }

        var q = getQuill();
        if (q) {
            applyCommentHighlights(q);
        }
    };

    window.cpRefreshComments = function() {
        return loadCommentsPanel();
    };

    window.cpResolve = function(id, btn) {
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        fetch('/api/comments/' + id + '/resolve', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' }
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.success) {
                var c = cpComments.find(function(x) { return x.id === id; });
                if (c) {
                    c.resolved = true;
                    c.resolved_at = new Date().toISOString();
                }
                renderCommentsPanel();
            } else {
                if (btn) { btn.disabled = false; btn.textContent = 'Resolved'; }
            }
        })
        .catch(function() {
            if (btn) { btn.disabled = false; btn.textContent = 'Resolved'; }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
