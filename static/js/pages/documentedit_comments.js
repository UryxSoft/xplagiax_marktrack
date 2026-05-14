/**
 * documentedit_comments.js
 * Inline comment system for the document review dashboard.
 * Includes text selection, @mentions, and comment lifecycle management.
 */

(function() {
    'use strict';

    // State
    const DOC_ID         = Number(window.MT_DATA?.id);
    const CSRF           = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
    const STUDENT_EMAIL  = window.MT_DATA?.invitation?.email;
    const STUDENT_NAME   = window.MT_DATA?.invitation?.name;

    let pendingRange     = null;
    let selectedColor    = '#FDE68A';
    let allComments      = [];
    let reviewValidated  = {};
    let mentionableUsers = [];
    let mentionedEmails   = [];
    let mentionLoaded     = false;

    // 1. Initial Load of Validated State
    try {
        const saved = localStorage.getItem('reviewValidated_' + DOC_ID);
        if (saved) reviewValidated = JSON.parse(saved);
    } catch(e) {}

    function saveReviewValidated() {
        try { localStorage.setItem('reviewValidated_' + DOC_ID, JSON.stringify(reviewValidated)); } catch(e) {}
    }

    // 2. Mentions System
    function loadMentionableUsers() {
        if (mentionLoaded) return;
        const list = [];
        if (STUDENT_EMAIL) {
            list.push({ email: STUDENT_EMAIL, name: STUDENT_NAME || STUDENT_EMAIL });
        }
        fetch(`/api/documents/${DOC_ID}/collaborators`)
            .then(r => r.json())
            .then(d => {
                (d.collaborators || []).forEach(c => {
                    if (c.user_email && !list.find(u => u.email === c.user_email)) {
                        list.push({ email: c.user_email, name: c.user_name || c.user_email });
                    }
                });
                mentionableUsers = list;
                mentionLoaded = true;
            })
            .catch(() => { mentionableUsers = list; mentionLoaded = true; });
    }

    function handleMentionInput(ta) {
        const val = ta.value;
        const pos = ta.selectionStart;
        const before = val.substring(0, pos);
        const match = before.match(/@(\S*)$/);
        if (!match) { hideMentionDropdown(); return; }
        const query = match[1].toLowerCase();
        const matches = mentionableUsers.filter(u =>
            u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)
        );
        if (!matches.length) { hideMentionDropdown(); return; }
        renderMentionDropdown(matches);
    }

    function renderMentionDropdown(matches) {
        const dd = document.getElementById('mentionDropdown');
        if (!dd) return;
        dd.innerHTML = matches.map(u => {
            const initial = (u.name || u.email)[0].toUpperCase();
            const safeName  = u.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const safeEmail = u.email.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            return `<div class="mention-item" onclick="MT_COMMENTS.selectMention('${u.email.replace(/'/g,"\\'")}','${u.name.replace(/'/g,"\\'")}')">
                <div class="mention-avatar">${initial}</div>
                <div><span class="mention-name">${safeName}</span><span class="mention-email">${safeEmail}</span></div>
            </div>`;
        }).join('');
        dd.style.display = 'block';
    }

    function hideMentionDropdown() {
        const dd = document.getElementById('mentionDropdown');
        if (dd) dd.style.display = 'none';
    }

    // 3. Quill Integration
    function waitForQuill(cb) {
        if (window.quillPagination && window.quillPagination.quill) {
            cb(window.quillPagination.quill);
        } else {
            setTimeout(() => waitForQuill(cb), 300);
        }
    }

    function handleSelection(quill) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.toString().trim() === '') return;

        const editorEl = document.querySelector('#editor-pages .ql-editor');
        if (!editorEl || (!editorEl.contains(sel.anchorNode) && !editorEl.contains(sel.focusNode))) return;

        let from, to;
        try {
            const wasDisabled = !quill.isEnabled();
            if (wasDisabled) quill.enable();
            const range = quill.getSelection();
            if (wasDisabled) /* quill.disable() */;
            if (!range || range.length === 0) return;
            from = range.index;
            to   = range.index + range.length;
        } catch (e) { return; }

        const selectedText = sel.toString().trim();
        if (!selectedText) return;

        pendingRange = { index: from, length: to - from, selectedText };
        showAnnotationPopover(selectedText);
    }

    function showAnnotationPopover(selectedText) {
        const popover = document.getElementById('annotationPopover');
        const preview = document.getElementById('annotationSelectionPreview');
        const textarea = document.getElementById('annotationText');
        if (!popover) return;

        const preview_text = selectedText.length > 120 ? selectedText.substring(0, 120) + '…' : selectedText;
        preview.textContent = '"' + preview_text + '"';
        textarea.value = '';
        popover.style.display = 'flex';
        textarea.focus();
    }

    function applyHighlight(index, length, color, commentId) {
        waitForQuill(function (quill) {
            try {
                const wasDisabled = !quill.isEnabled();
                if (wasDisabled) quill.enable();
                quill.formatText(index, length, { background: color, 'comment-id': commentId }, 'api');
                if (wasDisabled) /* quill.disable() */;
            } catch (e) { console.warn('[Comments] applyHighlight error:', e); }
        });
    }

    function updateCommentsBadge() {
        const unresolved = allComments.filter(c => !c.resolved).length;
        const badge = document.getElementById('commentsCountBadge');
        if (!badge) return;
        if (unresolved > 0) {
            badge.textContent = unresolved;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function commentCard(c) {
        const resolved   = c.resolved;
        const isValidated = !!reviewValidated[c.id];
        const colorDot   = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(c.color)};flex-shrink:0;"></span>`;

        const resolvedBadge = resolved
            ? (isValidated
                ? `<span class="cp-validated-badge">✓ Validated</span>`
                : `<span style="font-size:10px;background:rgba(52,211,153,.15);color:#34d399;border:1px solid rgba(52,211,153,.3);border-radius:4px;padding:1px 6px;">Resolved</span>`)
            : '';
        const textCls = resolved ? 'style="text-decoration:line-through; opacity:.5;"' : '';

        const repliesHtml = (c.replies || []).map(r => `
            <div style="margin-left:24px; margin-top:8px; padding:8px 12px; background:rgba(255,255,255,.03); border-left:2px solid rgba(255,255,255,.1); border-radius:0 6px 6px 0;">
                <div style="font-size:11px; font-weight:600; color:rgba(255,255,255,.6); margin-bottom:2px;">${esc(r.author_name)}</div>
                <div style="font-size:12px; color:rgba(255,255,255,.75);">${esc(r.text)}</div>
            </div>`).join('');

        const actions = !resolved ? `
            <div class="comment-card-actions">
                <button class="comment-action-btn" onclick="event.stopPropagation(); MT_COMMENTS.jumpToComment(${c.selection_from})">View in doc</button>
                <button class="comment-action-btn comment-action-resolve" onclick="event.stopPropagation(); MT_COMMENTS.resolveComment(${c.id})">Resolve ✓</button>
                <button class="comment-action-btn comment-action-delete" onclick="event.stopPropagation(); MT_COMMENTS.deleteComment(${c.id})">Delete</button>
            </div>` : `
            <div class="comment-card-actions">
                <button class="comment-action-btn" onclick="event.stopPropagation(); MT_COMMENTS.flashCommentHighlight(${c.id})">View in doc</button>
                <button class="comment-action-btn comment-action-delete" onclick="event.stopPropagation(); MT_COMMENTS.deleteComment(${c.id})">Delete</button>
            </div>`;

        const validateHtml = resolved ? `
            <div class="cp-validate-row${isValidated ? ' validated' : ''}" onclick="event.stopPropagation(); MT_COMMENTS.toggleReviewValidation(${c.id});">
                <input type="checkbox" class="cp-validate-cb" id="rvValidateCb_${c.id}"${isValidated ? ' checked' : ''}
                    onclick="event.stopPropagation(); MT_COMMENTS.toggleReviewValidation(${c.id});" />
                <label class="cp-validate-label" for="rvValidateCb_${c.id}" onclick="event.stopPropagation();">
                    ${isValidated ? 'Correction validated' : 'Validate correction'}
                </label>
            </div>` : '';

        const cardClick = (c.selection_from !== null && c.selection_to !== null)
            ? `onclick="MT_COMMENTS.flashCommentHighlight(${c.id})"`
            : '';

        return `
        <div class="comment-card ${resolved ? 'resolved' : ''}${resolved && isValidated ? ' cp-validated' : ''}" id="comment-card-${c.id}" style="cursor:pointer;" ${cardClick}>
            <div class="comment-card-header">
                ${colorDot}
                <span class="comment-author">${esc(c.author_name)}</span>
                ${resolvedBadge}
                <span class="comment-time">${esc(c.time_ago || '')}</span>
            </div>
            ${c.selection_from !== null ? `<div class="comment-selection-snippet">"${esc((c.selectedText || '').substring(0,80))}"</div>` : ''}
            <div class="comment-text" ${textCls}>${esc(c.text)}</div>
            ${repliesHtml}
            <div class="comment-footer-row">
                ${actions}
                ${validateHtml}
            </div>
        </div>`;
    }

    function renderCommentsList() {
        const container = document.getElementById('commentsList');
        if (!container) return;
        const loading = document.getElementById('commentsLoading');
        if (loading) loading.remove();

        if (allComments.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:40px 16px; color:rgba(255,255,255,0.3);"><div style="font-size:28px; margin-bottom:8px;">💬</div><p style="font-size:13px; margin:0;">No comments yet.<br>Select text to add one.</p></div>`;
            return;
        }

        const total = document.getElementById('commentsTotalLabel');
        if (total) total.textContent = `${allComments.length} comment${allComments.length !== 1 ? 's' : ''}`;
        container.innerHTML = allComments.map(c => commentCard(c)).join('');
    }

    function loadComments() {
        fetch(`/api/documents/${DOC_ID}/comments`)
            .then(r => r.json())
            .then(data => {
                allComments = data.comments || [];
                renderCommentsList();
                allComments.forEach(c => {
                    if (!c.resolved && c.selection_from !== null && c.selection_to !== null) {
                        applyHighlight(c.selection_from, c.selection_to - c.selection_from, c.color || '#FDE68A', c.id);
                    }
                });
                updateCommentsBadge();
            })
            .catch(() => {});
    }

    // Public API
    window.MT_COMMENTS = {
        selectMention(email, name) {
            const ta = document.getElementById('annotationText');
            if (!ta) return;
            const pos = ta.selectionStart;
            const before = ta.value.substring(0, pos);
            const after  = ta.value.substring(pos);
            const newBefore = before.replace(/@(\S*)$/, '@' + name + ' ');
            ta.value = newBefore + after;
            ta.focus();
            ta.setSelectionRange(newBefore.length, newBefore.length);
            hideMentionDropdown();
            if (!mentionedEmails.includes(email)) mentionedEmails.push(email);
        },
        closeAnnotationPopover() {
            const popover = document.getElementById('annotationPopover');
            if (popover) popover.style.display = 'none';
            hideMentionDropdown();
            pendingRange = null;
            mentionedEmails = [];
        },
        popoverSelectColor(btn, color) {
            selectedColor = color;
            document.querySelectorAll('.annotation-colors .swatch-sm').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        },
        selectColor(btn, color) {
            selectedColor = color;
            document.querySelectorAll('.color-swatches .swatch').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        },
        submitAnnotation() {
            if (!pendingRange) return;
            const text = (document.getElementById('annotationText')?.value || '').trim();
            if (!text) { document.getElementById('annotationText')?.focus(); return; }

            const btn = document.getElementById('annotationSubmitBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

            fetch(`/api/documents/${DOC_ID}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF() },
                body: JSON.stringify({
                    text: text,
                    selection_from: pendingRange.index,
                    selection_to: pendingRange.index + pendingRange.length,
                    color: selectedColor,
                    mentions: mentionedEmails,
                }),
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    this.closeAnnotationPopover();
                    applyHighlight(pendingRange.index, pendingRange.length, selectedColor, data.comment.id);
                    allComments.unshift(data.comment);
                    renderCommentsList();
                } else { alert(data.error || 'Error saving comment'); }
            })
            .catch(() => alert('Network error. Please try again.'))
            .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Comment'; } });
        },
        flashCommentHighlight(commentId) {
            const c = allComments.find(x => x.id === commentId);
            if (!c || c.selection_from === null || c.selection_to === null) return;
            const from = c.selection_from;
            const len  = Math.max(1, c.selection_to - from);
            const hlColor = c.color || '#FDE68A';

            waitForQuill(function (quill) {
                try {
                    const wasDisabled = !quill.isEnabled();
                    if (wasDisabled) quill.enable();
                    quill.formatText(from, len, { background: hlColor }, 'api');
                    if (wasDisabled) /* quill.disable() */;
                    const bounds = quill.getBounds(from, len);
                    const editorEl = document.querySelector('#editor-pages');
                    if (editorEl && bounds) editorEl.scrollTop = bounds.top - 120;

                    setTimeout(() => {
                        try {
                            const w = !quill.isEnabled();
                            if (w) quill.enable();
                            quill.formatText(from, len, { background: '#ffffff' }, 'api');
                            if (w) /* quill.disable() */;
                            setTimeout(() => {
                                try {
                                    const w2 = !quill.isEnabled();
                                    if (w2) quill.enable();
                                    quill.formatText(from, len, { background: hlColor }, 'api');
                                    if (w2) /* quill.disable() */;
                                    setTimeout(() => {
                                        try {
                                            const w3 = !quill.isEnabled();
                                            if (w3) quill.enable();
                                            quill.formatText(from, len, { background: false }, 'api');
                                            if (w3) /* quill.disable() */;
                                        } catch(e) {}
                                    }, 1500);
                                } catch(e) {}
                            }, 200);
                        } catch(e) {}
                    }, 400);
                } catch(e) {}
            });
        },
        jumpToComment(index) {
            if (index === null || index === undefined) return;
            waitForQuill(function (quill) {
                try {
                    const bounds = quill.getBounds(index);
                    const editorEl = document.querySelector('#editor-pages');
                    if (editorEl && bounds) editorEl.scrollTop = bounds.top - 120;
                } catch(e) {}
            });
        },
        resolveComment(commentId) {
            fetch(`/api/comments/${commentId}/resolve`, {
                method: 'POST',
                headers: { 'X-CSRFToken': CSRF(), 'Content-Type': 'application/json' },
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const c = allComments.find(x => x.id === commentId);
                    if (c) { c.resolved = true; c.resolved_at = new Date().toISOString(); }
                    renderCommentsList();
                    if (c && c.selection_from !== null) {
                        waitForQuill(function (quill) {
                            try {
                                const wd = !quill.isEnabled();
                                if (wd) quill.enable();
                                quill.formatText(c.selection_from, c.selection_to - c.selection_from, { background: false }, 'api');
                                if (wd) /* quill.disable() */;
                            } catch(e) {}
                        });
                    }
                    updateCommentsBadge();
                }
            })
            .catch(() => {});
        },
        deleteComment(commentId) {
            if (!confirm('Delete this comment?')) return;
            fetch(`/api/comments/${commentId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': CSRF() },
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    const c = allComments.find(x => x.id === commentId);
                    allComments = allComments.filter(x => x.id !== commentId);
                    if (c && c.selection_from !== null) {
                        waitForQuill(function (quill) {
                            try {
                                const wd = !quill.isEnabled();
                                if (wd) quill.enable();
                                quill.formatText(c.selection_from, c.selection_to - c.selection_from, { background: false }, 'api');
                                if (wd) /* quill.disable() */;
                            } catch(e) {}
                        });
                    }
                    renderCommentsList();
                    updateCommentsBadge();
                }
            })
            .catch(() => {});
        },
        toggleReviewValidation(commentId) {
            const c = allComments.find(x => x.id === commentId);
            if (!c || !c.resolved) return;

            if (reviewValidated[commentId]) {
                delete reviewValidated[commentId];
                if (c.selection_from !== null && c.selection_to !== null) {
                    waitForQuill(q => {
                        const wd = !q.isEnabled(); if (wd) q.enable();
                        q.formatText(c.selection_from, c.selection_to - c.selection_from, { background: c.color || '#FDE68A' }, 'api');
                        if (wd) /* q.disable() */;
                    });
                }
            } else {
                reviewValidated[commentId] = true;
                if (c.selection_from !== null && c.selection_to !== null) {
                    waitForQuill(q => {
                        const wd = !q.isEnabled(); if (wd) q.enable();
                        q.formatText(c.selection_from, c.selection_to - c.selection_from, { background: false }, 'api');
                        if (wd) /* q.disable() */;
                    });
                }
            }
            saveReviewValidated();
            renderCommentsList();
        }
    };

    // Initialization
    document.addEventListener('DOMContentLoaded', () => {
        const interval = setInterval(() => {
            if (window.MT_DATA) {
                clearInterval(interval);
                waitForQuill(quill => {
                    const editorContainer = document.getElementById('editor-pages');
                    if (editorContainer) {
                        editorContainer.addEventListener('mouseup', () => {
                            setTimeout(() => handleSelection(quill), 80);
                        });
                    }
                    setTimeout(() => loadComments(), 2200);
                });
                
                const ta = document.getElementById('annotationText');
                if (ta) {
                    ta.addEventListener('keydown', e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); MT_COMMENTS.submitAnnotation(); }
                        if (e.key === 'Escape') hideMentionDropdown();
                    });
                    ta.addEventListener('input', () => handleMentionInput(ta));
                }
                loadMentionableUsers();
            }
        }, 100);
    });

})();
