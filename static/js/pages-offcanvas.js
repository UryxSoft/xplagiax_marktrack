(function() {
    const PagesOffcanvas = {
        selected: new Set(),   // indices of selected cards
        dragGhost: null,
        isDragging: false,

        // ── rubber-band state ──
        rb: { active: false, startX: 0, startY: 0 },

        init() {
            this.trash     = document.getElementById('trashZone');
            this.grid      = document.getElementById('docsGrid');
            this.badge     = document.getElementById('pageCountBadge');
            this.selRect   = document.getElementById('selectionRect');
            this.container = document.getElementById('docsContainer');
            this.delBtn    = document.getElementById('deleteSelectedBtn');
            this.selCount  = document.getElementById('selectedCount');

            // Create drag ghost stack element
            this.dragGhost = document.createElement('div');
            this.dragGhost.className = 'drag-ghost-stack';
            this.dragGhost.innerHTML = `
                <div class="ghost-sheet"></div>
                <div class="ghost-sheet"></div>
                <div class="ghost-sheet"></div>
                <div class="ghost-count" id="ghostCount">1</div>`;
            document.body.appendChild(this.dragGhost);

            // Trash drop zone
            this.trash.addEventListener('dragover', e => {
                e.preventDefault();
                this.trash.classList.add('drag-active');
            });
            this.trash.addEventListener('dragleave', () => this.trash.classList.remove('drag-active'));
            this.trash.addEventListener('drop', e => {
                e.preventDefault();
                this.trash.classList.remove('drag-active');
                this.deleteSelected();
            });

            // Delete button
            this.delBtn.addEventListener('click', () => this.deleteSelected());

            // Rubber-band selection on container background
            this.container.addEventListener('mousedown', e => this.onMouseDown(e));
            document.addEventListener('mousemove', e => this.onMouseMove(e));
            document.addEventListener('mouseup',   e => this.onMouseUp(e));

            // Deselect all on Escape
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') { this.clearSelection(); }
                if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size > 0 &&
                    document.getElementById('pagesOffcanvas')?.classList.contains('offcanvas-visible')) {
                    this.deleteSelected();
                }
            });
        },

        refresh() {
            if (!this.grid) return;
            const cards = this.grid.querySelectorAll('.doc-card');
            cards.forEach(card => {
                const index = parseInt(card.dataset.index);
                this.renderPageComments(card, index);
            });
        },

        // ── Build one paper card ──────────────────────────────────────
        buildCard(quillPage, index, total, pagination) {
            // In single-instance mode all quillPage.quill references point to the same instance.
            // We approximate page content by slicing the full text by page index.
            const quill   = quillPage.quill;
            const fullText= quill.getText();

            // Split full text into virtual pages using pagination's usable height heuristic
            // (approximate: 60 chars per line × 42 lines ≈ 2520 chars per page)
            const charsPerPage = pagination ? Math.max(800, Math.floor(
                pagination._getUsableHeight ? pagination._getUsableHeight() * 0.25 : 2000
            )) : 2000;
            const start   = index * charsPerPage;
            const excerpt = fullText.substring(start, start + charsPerPage).trim();
            const lines   = excerpt.split('\n').filter(l => l.trim());
            const title   = lines[0] ? lines[0].substring(0, 50) : '';
            const body    = lines.slice(1).join(' ').substring(0, 200) || '…';

            const card = document.createElement('div');
            card.className     = 'doc-card';
            card.dataset.index = index;
            card.draggable     = true;

            card.innerHTML = `
                <div class="doc-page-body">
                    <div class="doc-page-badge">PAGE ${index + 1}</div>
                    <div class="doc-page-title">${this.esc(title || (index === 0 ? 'Page 1' : 'Page ' + (index + 1)))}</div>
                    <div class="doc-page-text">${this.esc(body)}</div>
                </div>
                <div class="doc-check">
                    <svg viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>
                <div class="page-comments-container" id="pageComments-${index}"></div>`;

            // Single click: scroll to approximate position in the single editor
            card.addEventListener('click', e => {
                if (this.rb.active) return;
                if (e.ctrlKey || e.metaKey) {
                    this.toggleSelect(index);
                } else if (e.shiftKey && this.selected.size > 0) {
                    this.rangeSelect(index);
                } else {
                    this.clearSelection();
                    // Scroll the editor-wrapper container precisely to the page bounds
                    const wrapper = document.querySelector('.editor-wrapper');
                    if (wrapper && pagination && typeof pagination._getPageSlices === 'function') {
                        const slice = pagination._getPageSlices()[index];
                        if (slice) {
                            const bounds = quill.getBounds(slice.start);
                            if (bounds) {
                                // Add 20px padding logic relative to wrapper top
                                wrapper.scrollTo({ top: bounds.top + 20, behavior: 'smooth' });
                            }
                        }
                    }
                    setTimeout(() => quill.focus(), 350);
                }
            });

            card.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.showContextMenu(e, index, quill, pagination);
            });

            // Drag handlers remain as before (visual only)
            card.addEventListener('dragstart', e => {
                if (!this.selected.has(index)) {
                    if (!e.ctrlKey && !e.metaKey) this.clearSelection();
                    this.addSelect(index);
                }
                const blank = document.createElement('canvas');
                blank.width = blank.height = 1;
                e.dataTransfer.setDragImage(blank, 0, 0);
                e.dataTransfer.effectAllowed = 'move';
                this.isDragging = true;
                this.selected.forEach(i => {
                    const c = this.grid.querySelector(`[data-index="${i}"]`);
                    if (c) c.classList.add('dragging');
                });
                const n  = this.selected.size;
                const gc = document.getElementById('ghostCount');
                if (gc) gc.textContent = n;
                const sheets = this.dragGhost.querySelectorAll('.ghost-sheet');
                sheets[0].style.display = n > 1 ? '' : 'none';
                sheets[1].style.display = n > 1 ? '' : 'none';
                this.dragGhost.style.display = 'block';
                this.dragGhost.style.left = (e.clientX - 35) + 'px';
                this.dragGhost.style.top  = (e.clientY - 50) + 'px';
            });
            card.addEventListener('drag', e => {
                if (e.clientX === 0 && e.clientY === 0) return;
                this.dragGhost.style.left = (e.clientX - 35) + 'px';
                this.dragGhost.style.top  = (e.clientY - 50) + 'px';
            });
            card.addEventListener('dragend', () => {
                this.isDragging = false;
                this.dragGhost.style.display = 'none';
                document.querySelectorAll('.doc-card.dragging').forEach(c => c.classList.remove('dragging'));
                document.querySelectorAll('.doc-card.drop-target').forEach(c => c.classList.remove('drop-target'));
            });
            card.addEventListener('dragover', e => {
                e.preventDefault();
                if (!this.selected.has(index)) card.classList.add('drop-target');
            });
            card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
            card.addEventListener('drop', e => {
                e.preventDefault();
                card.classList.remove('drop-target');
                if (this.selected.has(index)) return;
                const sourceIndices = [...this.selected].sort((a,b) => a-b);
                if (pagination && pagination.movePages && sourceIndices.length > 0) {
                    pagination.movePages(sourceIndices, index);
                    this.showToast(`${sourceIndices.length} page(s) moved`);
                }
                this.clearSelection();
            });

            this.renderPageComments(card, index);
            return card;
        },

        renderPageComments(card, index) {
            const container = card.querySelector('.page-comments-container');
            if (!container || !window.cpComments) return;

            // Remove any existing badge first
            const oldBadge = card.querySelector('.page-comment-count-badge');
            if (oldBadge) oldBadge.remove();

            // Filter comments for this page (robust comparison)
            const pageComments = window.cpComments.filter(c => c.page_index !== null && Number(c.page_index) === Number(index));
            if (pageComments.length === 0) {
                container.innerHTML = '';
                return;
            }

            const visibleLimit = 3;
            const toShow = pageComments.slice(0, visibleLimit);
            const extra = pageComments.length - visibleLimit;

            container.innerHTML = '';
            
            // Show Count Badge (Red notification bubble) - Attach to card for top-right positioning
            if (pageComments.length > 0) {
                const countBadge = document.createElement('div');
                countBadge.className = 'page-comment-count-badge';
                countBadge.textContent = pageComments.length;
                card.appendChild(countBadge);
            }

            if (extra > 0) {
                const badge = document.createElement('div');
                badge.className = 'comment-initial-bubble';
                badge.style.background = 'rgba(255,255,255,0.1)';
                badge.style.color = 'rgba(255,255,255,0.6)';
                badge.textContent = `+${extra}`;
                container.appendChild(badge);
            }

            toShow.forEach(c => {
                const bubble = document.createElement('div');
                bubble.className = 'comment-initial-bubble';
                const initial = (c.author_name || c.author_email || '?')[0].toUpperCase();
                bubble.textContent = initial;
                bubble.title = `${c.author_name || c.author_email}: ${c.text.substring(0, 50)}...`;
                container.appendChild(bubble);
            });
            if (window.lucide) lucide.createIcons();
        },

        // ── Selection helpers ─────────────────────────────────────────
        addSelect(i) {
            this.selected.add(i);
            const c = this.grid.querySelector(`[data-index="${i}"]`);
            if (c) c.classList.add('selected');
            this.updateSelUI();
        },
        toggleSelect(i) {
            if (this.selected.has(i)) {
                this.selected.delete(i);
                const c = this.grid.querySelector(`[data-index="${i}"]`);
                if (c) c.classList.remove('selected');
            } else {
                this.addSelect(i);
            }
            this.updateSelUI();
        },
        rangeSelect(toIdx) {
            const sorted = [...this.selected].sort((a,b) => a-b);
            const from = sorted[sorted.length - 1] ?? 0;
            const lo = Math.min(from, toIdx), hi = Math.max(from, toIdx);
            for (let i = lo; i <= hi; i++) this.addSelect(i);
            this.updateSelUI();
        },
        clearSelection() {
            this.selected.clear();
            document.querySelectorAll('.doc-card.selected').forEach(c => c.classList.remove('selected'));
            this.updateSelUI();
        },
        updateSelUI() {
            const n = this.selected.size;
            this.delBtn.disabled = n === 0;
            this.selCount.textContent = n > 0 ? `${n} selected` : '';
        },

        // ── Rubber-band mouse selection ───────────────────────────────
        onMouseDown(e) {
            // Only on the container background (not on a card)
            if (e.target.closest('.doc-card')) return;
            if (e.button !== 0) return;

            const rect = this.container.getBoundingClientRect();
            this.rb.active = true;
            this.rb.startX = e.clientX - rect.left + this.container.scrollTop;
            this.rb.startY = e.clientY - rect.top  + this.container.scrollTop;

            this.selRect.style.display = 'block';
            this.selRect.style.left   = (this.rb.startX) + 'px';
            this.selRect.style.top    = (this.rb.startY) + 'px';
            this.selRect.style.width  = '0px';
            this.selRect.style.height = '0px';

            if (!e.ctrlKey && !e.metaKey) this.clearSelection();
        },
        onMouseMove(e) {
            if (!this.rb.active) return;
            const rect = this.container.getBoundingClientRect();
            const curX = e.clientX - rect.left + this.container.scrollTop;
            const curY = e.clientY - rect.top  + this.container.scrollTop;

            const x = Math.min(this.rb.startX, curX);
            const y = Math.min(this.rb.startY, curY);
            const w = Math.abs(curX - this.rb.startX);
            const h = Math.abs(curY - this.rb.startY);

            this.selRect.style.left   = x + 'px';
            this.selRect.style.top    = y + 'px';
            this.selRect.style.width  = w + 'px';
            this.selRect.style.height = h + 'px';

            // Hit-test cards
            const selBox = { x, y, w, h };
            const contRect = this.container.getBoundingClientRect();
            this.grid.querySelectorAll('.doc-card').forEach(card => {
                const cr = card.getBoundingClientRect();
                const cx = cr.left - contRect.left + this.container.scrollLeft;
                const cy = cr.top  - contRect.top  + this.container.scrollTop;
                const overlaps =
                    cx < selBox.x + selBox.w && cx + cr.width > selBox.x &&
                    cy < selBox.y + selBox.h && cy + cr.height > selBox.y;
                const idx = parseInt(card.dataset.index);
                if (overlaps) this.addSelect(idx);
                else if (!e.ctrlKey) {
                    this.selected.delete(idx);
                    card.classList.remove('selected');
                    this.updateSelUI();
                }
            });
        },
        onMouseUp(e) {
            if (!this.rb.active) return;
            this.rb.active = false;
            this.selRect.style.display = 'none';
        },

        // ── Delete selected pages ─────────────────────────────────────
        deleteSelected() {
            const pagination = window.quillPagination;
            if (!pagination) return;

            const toDelete = [...this.selected].sort((a,b) => b-a); // descending
            if (toDelete.length === 0) return;

            const count = toDelete.length;
            const msg = count === 1 ? 'Are you sure you want to delete this page?' : `Are you sure you want to delete these ${count} pages?`;

            this.confirmDelete(msg, () => {
                // Can't delete all pages - keep at least 1
                const keepLast = toDelete.length >= pagination.pages.length;

                if (keepLast) {
                    pagination.isUpdating = true;
                    while (pagination.pages.length > 1) pagination.removePage(1);
                    pagination.pages[0].quill.setContents([{ insert: '\n' }]);
                    pagination.isUpdating = false;
                    this.showToast('All pages cleared (kept 1 empty page)');
                } else {
                    pagination.isUpdating = true;
                    toDelete.forEach(idx => {
                        if (pagination.pages.length > 1) pagination.removePage(idx);
                    });
                    pagination.isUpdating = false;
                    this.showToast(`${count} page${count > 1 ? 's' : ''} deleted`);
                }

                this.clearSelection();
                this.refresh();
            });
        },

        confirmDelete(text, onConfirm) {
            const modal = document.getElementById('deleteConfirmModal');
            const textEl = document.getElementById('deleteConfirmText');
            const confirmBtn = document.getElementById('confirmDeleteBtn');
            const cancelBtn = document.getElementById('cancelDeleteBtn');
            if (!modal || !textEl || !confirmBtn || !cancelBtn) return;

            textEl.textContent = text;
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.style.opacity = '1';
                const content = modal.querySelector('.mt-modal-content');
                if (content) content.style.transform = 'translateY(0)';
            }, 10);

            const close = () => {
                modal.style.opacity = '0';
                const content = modal.querySelector('.mt-modal-content');
                if (content) content.style.transform = 'translateY(20px)';
                setTimeout(() => { modal.style.display = 'none'; }, 300);
            };

            confirmBtn.onclick = () => {
                onConfirm();
                close();
            };
            cancelBtn.onclick = close;
            if (window.lucide) lucide.createIcons();
        },

        // ── Context Menu (Double Click) ─────────────────────────────
        showContextMenu(e, pageIndex, quill, pagination) {
            let menu = document.getElementById('pagesContextMenu');
            if (menu) menu.remove();

            menu = document.createElement('div');
            menu.id = 'pagesContextMenu';
            menu.className = 'context-menu-glass';
            menu.innerHTML = `
                <div class="ctx-header">Page ${pageIndex + 1} Options</div>
                <button class="ctx-btn" id="ctxDel"><i class="bi bi-trash"></i> Delete Page</button>
                <button class="ctx-btn" id="ctxCopy"><i class="bi bi-copy"></i> Copy Content</button>
                <button class="ctx-btn" id="ctxComment"><i class="bi bi-chat-left-text"></i> Add Comment</button>
                <button class="ctx-btn" id="ctxPdf"><i class="bi bi-file-earmark-pdf"></i> Download PDF</button>
            `;
            
            document.body.appendChild(menu);
            
            // Positioning near the cursor
            menu.style.left = `${e.clientX + 10}px`;
            menu.style.top = `${e.clientY + 10}px`;
            
            // Show animation
            requestAnimationFrame(() => menu.classList.add('visible'));

            // Handlers
            menu.querySelector('#ctxDel').onclick = () => {
                this.confirmDelete('Are you sure you want to delete this page?', () => {
                    pagination.removePage(pageIndex);
                    this.showToast('Page deleted');
                    this.refresh();
                });
                this.closeContextMenu();
            };
            
            const extractHtml = () => {
                const slices = pagination._getPageSlices();
                const slice = slices.find(s => s.page === pageIndex);
                if (!slice) return "";
                const delta = quill.getContents(slice.start, slice.length);
                const tempDiv = document.createElement('div');
                const tempQuill = new Quill(tempDiv);
                tempQuill.setContents(delta);
                return tempQuill.root.innerHTML;
            };

            menu.querySelector('#ctxCopy').onclick = () => {
                const slices = pagination._getPageSlices();
                const slice = slices.find(s => s.page === pageIndex);
                if (slice) {
                    const text = quill.getText(slice.start, slice.length);
                    navigator.clipboard.writeText(text).then(() => this.showToast('Text copied to clipboard'));
                }
                this.closeContextMenu();
            };
            
            menu.querySelector('#ctxComment').onclick = () => {
                this.openCommentModal(pageIndex);
                this.closeContextMenu();
            };

            menu.querySelector('#ctxPdf').onclick = () => {
                const html = extractHtml();
                const iframe = document.createElement('iframe');
                iframe.style.position = 'fixed';
                iframe.style.right = '0';
                iframe.style.bottom = '0';
                iframe.style.width = '0';
                iframe.style.height = '0';
                iframe.style.border = '0';
                document.body.appendChild(iframe);
                
                const frameDoc = iframe.contentWindow.document;
                frameDoc.write(`
                    <html>
                        <head>
                            <title>MarkTrack_Document_Page_${pageIndex + 1}</title>
                            <style>
                                body { font-family: 'Helvetica', sans-serif; font-size: 11pt; line-height: 1.5; padding: 2cm; margin: 0; color: #000; }
                                p { margin-top: 0; margin-bottom: 1em; }
                                @page { margin: 0; }
                                @media print { body { padding: 2cm; } }
                            </style>
                        </head>
                        <body>${html}</body>
                    </html>
                `);
                frameDoc.close();
                
                setTimeout(() => {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                    setTimeout(() => iframe.remove(), 1000);
                }, 400);
                this.closeContextMenu();
            };

            // Close listeners
            const closeMenu = (evt) => {
                if (!menu.contains(evt.target)) {
                    this.closeContextMenu();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 10);
        },
        
        closeContextMenu() {
            const menu = document.getElementById('pagesContextMenu');
            if (menu) {
                menu.classList.remove('visible');
                setTimeout(() => menu.remove(), 200);
            }
        },

        openCommentModal(pageIndex, skipRefresh = false) {
            const modal = document.getElementById('pageCommentModal');
            const title = document.getElementById('pageCommentModalTitle');
            const textarea = document.getElementById('pageCommentText');
            const saveBtn = document.getElementById('savePageCommentBtn');
            const saveBtnText = document.getElementById('saveBtnText');
            const listContainer = document.getElementById('modalCommentsList');
            const areaTitle = document.getElementById('commentAreaTitle');

            if (!modal || !title || !textarea || !saveBtn || !listContainer) return;

            // Always refresh from server to ensure list is fresh
            if (!skipRefresh && window.cpRefreshComments) {
                window.cpRefreshComments().then(() => this.openCommentModal(pageIndex, true));
                return;
            }

            let editingId = null;

            title.textContent = `Comments - Page ${pageIndex + 1}`;
            textarea.value = '';
            areaTitle.textContent = 'New Comment';
            saveBtnText.textContent = 'Save Comment';

            // Populate existing (robust type comparison)
            const pageComments = (window.cpComments || []).filter(c => c.page_index !== null && Number(c.page_index) === Number(pageIndex));
            listContainer.innerHTML = '';
            
            if (pageComments.length === 0) {
                listContainer.innerHTML = '<div style="padding:20px; text-align:center; color:var(--t3); font-size:12px;">No comments yet on this page.</div>';
            } else {
                pageComments.forEach(c => {
                    const item = document.createElement('div');
                    item.className = 'modal-comment-item';
                    item.innerHTML = `
                        <div class="modal-comment-header">
                            <span class="modal-comment-author">${this.esc(c.author_name || c.author_email)}</span>
                            <span style="font-size:10px; color:var(--t3);">${c.created_at.split('T')[0]}</span>
                        </div>
                        <div class="modal-comment-text">${this.esc(c.text)}</div>
                        <div class="modal-comment-actions">
                            <button class="btn-comment-action btn-edit-comment" data-id="${c.id}">
                                <i data-lucide="edit-3" style="width:12px;height:12px;"></i> Edit
                            </button>
                            <button class="btn-comment-action btn-del-comment" data-id="${c.id}" style="color:#ef4444;">
                                <i data-lucide="trash" style="width:12px;height:12px;"></i> Delete
                            </button>
                        </div>
                    `;
                    listContainer.appendChild(item);
                });

                // Attach listeners
                listContainer.querySelectorAll('.btn-edit-comment').forEach(btn => {
                    btn.onclick = () => {
                        const id = parseInt(btn.getAttribute('data-id'));
                        const comment = pageComments.find(x => x.id === id);
                        if (comment) {
                            editingId = id;
                            textarea.value = comment.text;
                            areaTitle.textContent = 'Editing Comment';
                            saveBtnText.textContent = 'Update Comment';
                            textarea.focus();
                        }
                    };
                });

                listContainer.querySelectorAll('.btn-del-comment').forEach(btn => {
                    btn.onclick = () => {
                        // Prevent multiple confirm cards
                        if (btn.closest('.modal-comment-item').querySelector('.modal-comment-delete-confirm')) return;

                        const id = btn.getAttribute('data-id');
                        const item = btn.closest('.modal-comment-item');
                        
                        // Create confirm UI
                        const confirmDiv = document.createElement('div');
                        confirmDiv.className = 'modal-comment-delete-confirm';
                        confirmDiv.innerHTML = `
                            <div class="delete-confirm-text">Are you sure you want to delete?</div>
                            <div class="delete-confirm-btns">
                                <button class="btn-delete-confirm yes">Delete Permanently</button>
                                <button class="btn-delete-confirm no">Cancel</button>
                            </div>
                        `;

                        // Hide original actions temporarily
                        const actions = item.querySelector('.modal-comment-actions');
                        if (actions) actions.style.display = 'none';
                        
                        item.appendChild(confirmDiv);

                        confirmDiv.querySelector('.yes').onclick = () => {
                            confirmDiv.querySelector('.yes').disabled = true;
                            confirmDiv.querySelector('.yes').textContent = 'Deleting...';
                            
                            fetch(`/api/comments/${id}`, {
                                method: 'DELETE',
                                headers: { 'X-CSRFToken': window.csrfToken() }
                            }).then(() => {
                                if (window.cpRefreshComments) {
                                    window.cpRefreshComments().then(() => {
                                        this.openCommentModal(pageIndex);
                                    });
                                }
                            });
                        };

                        confirmDiv.querySelector('.no').onclick = () => {
                            confirmDiv.remove();
                            if (actions) actions.style.display = 'flex';
                        };
                    };
                });
            }

            modal.style.display = 'flex';
            setTimeout(() => {
                modal.style.opacity = '1';
                const content = modal.querySelector('.mt-modal-content');
                if (content) content.style.transform = 'translateY(0)';
            }, 10);

            if (window.lucide) lucide.createIcons();
            
            saveBtn.onclick = () => {
                const text = textarea.value.trim();
                if (!text) return;

                saveBtn.disabled = true;
                saveBtnText.textContent = 'Saving...';

                const url = editingId ? `/api/comments/${editingId}` : `/api/documents/${window.DOCUMENT_ID}/comments`;
                const method = editingId ? 'PATCH' : 'POST';

                fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': (typeof window.csrfToken === 'function') ? window.csrfToken() : ''
                    },
                    body: JSON.stringify({
                        text: text,
                        page_index: pageIndex,
                        color: '#3b82f6'
                    })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        this.showToast(editingId ? 'Comment updated' : 'Comment saved');
                        
                        // Reset input and mode
                        textarea.value = '';
                        editingId = null;
                        areaTitle.textContent = 'New Comment';
                        saveBtnText.textContent = 'Save Comment';

                        // Refresh all and rebuild the modal list
                        if (window.cpRefreshComments) {
                            window.cpRefreshComments().then(() => {
                                // Re-run openCommentModal logic (simplified) to refresh the list
                                this.openCommentModal(pageIndex);
                            });
                        }
                    } else {
                        this.showToast('Error: ' + (data.error || 'Could not save comment'));
                    }
                })
                .catch(e => {
                    this.showToast('Network error');
                })
                .finally(() => {
                    saveBtn.disabled = false;
                    saveBtnText.textContent = editingId ? 'Update Comment' : 'Save Comment';
                });
            };
        },

        // ── Legacy Reorder (Removed as native drag drop used) ─────────
        reorderSelected(targetIdx) {
            const pagination = window.quillPagination;
            if (!pagination || this.selected.size === 0) return;

            const selectedArr = [...this.selected].sort((a,b) => a-b);
            const savedContents = selectedArr.map(i => pagination.pages[i].quill.getContents());
            const targetContent = pagination.pages[targetIdx].quill.getContents();

            // Simple swap of the first selected with target
            if (selectedArr.length === 1) {
                const [i] = selectedArr;
                pagination.isUpdating = true;
                pagination.pages[i].quill.setContents(targetContent);
                pagination.pages[targetIdx].quill.setContents(savedContents[0]);
                pagination.isUpdating = false;
                this.showToast(`Pages ${i+1} and ${targetIdx+1} swapped`);
            }

            this.clearSelection();
            this.refresh();
        },

        // ── Refresh all cards from Quill state ────────────────────────
        refresh() {
            const pagination = window.quillPagination;
            if (!pagination || !pagination.pages || pagination.pages.length === 0) {
                this.grid.innerHTML = `<div style="grid-column:1/-1;color:var(--t3);font-size:11px;padding:20px;text-align:center;">Start writing to see pages here.</div>`;
                return;
            }
            this.grid.innerHTML = '';
            const pages = pagination.pages;
            pages.forEach((page, i) =>
                this.grid.appendChild(this.buildCard(page, i, pages.length, pagination)));
            if (this.badge) this.badge.textContent = pages.length;
            this.updateSelUI();
        },

        showToast(msg) {
            const t = document.createElement('div');
            t.style.cssText = `
                position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
                background:rgba(20,22,28,.92);border:1px solid var(--glass-bdr);
                color:var(--t1);padding:8px 18px;border-radius:8px;font-size:12px;
                font-weight:600;z-index:9999;backdrop-filter:blur(12px);
                animation:fadeInUp .2s ease;white-space:nowrap;`;
            t.textContent = msg;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2500);
        },

        esc(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
    };

    function refreshDocCards() { PagesOffcanvas.refresh(); }
    // Initialize offcanvas + toolbar relocation after bridge loads
    window.addEventListener('load', () => {
        setTimeout(() => {
            PagesOffcanvas.init();

            // ── Move Quill toolbar below app-header ────────────────────
            function relocateToolbar() {
                const toolbarBar = document.getElementById('quill-toolbar-bar');
                if (!toolbarBar) return;
                const existing = toolbarBar.querySelector('.ql-toolbar');
                if (existing) return; // already moved

                const toolbar = document.querySelector('#editor-pages .ql-toolbar');
                if (!toolbar) return;

                toolbarBar.appendChild(toolbar);
                console.log('✅ Quill toolbar relocated to header bar');
            }

            // Try immediately then keep retrying until relocated
            const relocInterval = setInterval(() => {
                relocateToolbar();
                if (document.getElementById('quill-toolbar-bar')?.querySelector('.ql-toolbar')) {
                    clearInterval(relocInterval);
                }
            }, 200);

            // ── Hook into page creation/removal to refresh cards ───────
            const hookInterval = setInterval(() => {
                const pagination = window.quillPagination;
                if (!pagination) return;
                clearInterval(hookInterval);

                // Also move toolbar once pagination is ready
                setTimeout(relocateToolbar, 50);

                // In single-instance mode, createPage/removePage are stubs — safe to bind
                if (typeof pagination.createPage === 'function') {
                    const origCreate = pagination.createPage.bind(pagination);
                    pagination.createPage = function(...args) {
                        const result = origCreate(...args);
                        PagesOffcanvas.refresh();
                        if (PagesOffcanvas.badge) PagesOffcanvas.badge.textContent = pagination.pages.length;
                        return result;
                    };
                }
                if (typeof pagination.removePage === 'function') {
                    const origRemove = pagination.removePage.bind(pagination);
                    pagination.removePage = function(...args) {
                        origRemove(...args);
                        PagesOffcanvas.refresh();
                        if (PagesOffcanvas.badge) PagesOffcanvas.badge.textContent = pagination.pages.length;
                    };
                }

                // Listen for repagination events and refresh cards
                if (pagination.quill) {
                    pagination.quill.on('text-change', () => {
                        clearTimeout(PagesOffcanvas._refreshTimer);
                        PagesOffcanvas._refreshTimer = setTimeout(() => PagesOffcanvas.refresh(), 600);
                    });
                }

                PagesOffcanvas.refresh();
            }, 500);
        }, 800);
    });



})();
