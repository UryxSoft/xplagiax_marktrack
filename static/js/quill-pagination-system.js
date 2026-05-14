// ===================================================================
// QUILL PAGINATION SYSTEM v4 — Single Instance, Zero-Loop Design
// No ResizeObserver loop. Page breaks via CSS only when content
// exceeds page height. Dispatches 'quillPaginationReady' event.
// ===================================================================

class QuillPagination {
    constructor(options = {}) {
        if (typeof Quill === 'undefined') {
            throw new Error('[QuillPagination] Quill.js must be loaded first');
        }

        this.config = {
            pageWidth:         options.pageWidth    || '210mm',
            pageHeight:        options.pageHeight   || '297mm',
            // pagePadding from bridge passes '15mm'; use that
            pagePadding:       options.pagePadding  || options.pageMargin || '20mm',
            containerSelector: options.container    || '#editor-pages',
            theme:             options.theme        || 'snow',
            toolbar:           options.toolbar !== undefined ? options.toolbar : '#custom-toolbar',
            placeholder:       options.placeholder  || 'Start writing...',
            onTextChange:      options.onTextChange || null,
            onNewPage:         options.onNewPage    || null,
            autoPageBreak:     options.autoPageBreak !== false,
            showPageNumbers:   options.showPageNumbers !== false,
            readOnly:          options.readOnly === true,
        };

        // All page math in pixels
        this._pageH   = this._mmToPx(297);  // A4 height
        this._padPx   = this._mmToPx(parseFloat(this.config.pagePadding) || 20);
        this._usableH = this._pageH - this._padPx * 2;

        this.quill            = null;
        this.container        = null;
        this._pageWrapper     = null;
        this._editorHost      = null;
        this._overlay         = null;
        this.pageCount        = 1;
        this.currentPageIndex = 0;
        this.isUpdating       = false;
        this._paginateTimer   = null;
        this._prevContentH    = 0;   // track last measured height to skip no-op runs

        // Legacy compat (pages-offcanvas.js, bridge, etc.)
        this.pages          = [];
        this.quillInstances = [];
        this.focusedQuill   = null;

        this._init();
    }

    // ── Build DOM ────────────────────────────────────────────────────
    _init() {
        this.container = document.querySelector(this.config.containerSelector);
        if (!this.container) {
            console.error('[QP] Container not found:', this.config.containerSelector);
            return;
        }

        this._buildDOM();
        this._injectStyles();
        this._createQuill();
        this._setupHandlers();
        this._syncCompat();

        // Signal that pagination is ready (invite-editor.js listens for this)
        setTimeout(() => {
            // Expose quill instance for collab-sync.js (Yjs binding) and other modules
            window._paginationQuill = this.quill;
            document.dispatchEvent(new CustomEvent('quillPaginationReady', {
                detail: { pagination: this }
            }));
        }, 0);

        console.log('[QP] Ready — single-instance v4');
    }

    _buildDOM() {
        this.container.innerHTML = '';
        this.container.className = 'qp-canvas';

        this._pageWrapper = document.createElement('div');
        this._pageWrapper.className = 'qp-page qpage';

        // Overlay sits ABOVE the editor host, pointer-events: none
        this._overlay = document.createElement('div');
        this._overlay.className = 'qp-overlay';
        this._overlay.setAttribute('aria-hidden', 'true');

        this._editorHost = document.createElement('div');
        this._editorHost.className = 'qp-host';

        this._pageWrapper.appendChild(this._overlay);
        this._pageWrapper.appendChild(this._editorHost);
        this.container.appendChild(this._pageWrapper);
    }

    _createQuill() {
        const tb = typeof this.config.toolbar === 'string'
            ? document.querySelector(this.config.toolbar) || this.config.toolbar
            : this.config.toolbar;

        const baseModules = {
            toolbar:   tb,
            history:   { delay: 1000, maxStack: 200 },
            clipboard: { matchVisual: false },
        };
        
        // Merge any extra modules passed from the integration wrapper
        const finalModules = { ...baseModules, ...(this.config.quillModules || {}) };

        this.quill = new Quill(this._editorHost, {
            theme:   this.config.theme,
            readOnly: this.config.readOnly,
            modules: finalModules,
            placeholder: this.config.placeholder,
        });

        this.focusedQuill = this.quill;

        this.quill.on('selection-change', (range) => {
            if (range) {
                this._updateCurrentPage();
                this._updateBadge();
            }
        });
    }

    // ── Main handlers ────────────────────────────────────────────────
    _setupHandlers() {
        // 1. Image handler — capture selection BEFORE file picker
        const toolbar = this.quill.getModule('toolbar');
        if (toolbar) {
            toolbar.addHandler('image', () => {
                let r = this.quill.getSelection(true);
                if (!r) r = { index: Math.max(0, this.quill.getLength() - 1), length: 0 };

                const inp  = document.createElement('input');
                inp.type   = 'file';
                inp.accept = 'image/png,image/jpeg,image/jpg,image/gif,image/webp';
                inp.onchange = async () => {
                    const file = inp.files[0];
                    if (!file || file.size > 5 * 1024 * 1024) return;
                    const url = await this._uploadOrBase64(file);
                    if (!url) return;
                    this.quill.insertEmbed(r.index, 'image', url, 'user');
                    this.quill.setSelection(r.index + 1, 0, 'silent');
                };
                inp.click();
            });
        }

        // 2. Text-change — debounced repaginate (no ResizeObserver to avoid loops)
        this.quill.on('text-change', (delta, old, source) => {
            if (this.config.autoPageBreak) {
                clearTimeout(this._paginateTimer);
                this._paginateTimer = setTimeout(() => this._repaginate(), 300);
            }
            if (source === 'user' && this.config.onTextChange) {
                this.config.onTextChange(this.getAllContent(), source);
            }
        });
    }

    // ── Repaginate — zero ResizeObserver, no min-height manipulation ─
    _repaginate() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        try {
            // Measure the ACTUAL content height by summing child node heights.
            // Do NOT use offsetHeight (inflated by min-height CSS) or
            // scrollHeight (inflated by scroll position).
            const contentH = this._measureContentHeight();

            // Skip if content height hasn't changed (avoids loop after we draw overlay)
            if (contentH === this._prevContentH) return;
            this._prevContentH = contentH;

            const newCount = Math.max(1, Math.ceil(contentH / this._usableH));

            // Expand wrapper height to cover all pages without triggering observers
            const targetH = Math.max(newCount * this._pageH, this._pageH);
            this._pageWrapper.style.height = targetH + 'px';

            this._drawOverlay(contentH, newCount);

            if (newCount !== this.pageCount) {
                this.pageCount = newCount;
                this._syncCompat();
                if (this.config.onNewPage && newCount > 1) {
                    this.config.onNewPage(this.quill, newCount - 1);
                }
            }

            this._updateCurrentPage();
            this._updateBadge();
        } finally {
            this.isUpdating = false;
        }
    }

    // Sum actual child heights — ignores CSS min-height
    _measureContentHeight() {
        const editor = this.quill.root;
        let total = 0;
        for (const child of editor.children) {
            // Skip our own injected overlay nodes (none inside ql-editor, but safe guard)
            total += child.getBoundingClientRect().height || child.offsetHeight || 0;
        }
        // Add top+bottom padding of the editor
        const style  = getComputedStyle(editor);
        const padTop = parseFloat(style.paddingTop)    || 0;
        // Note: we do NOT include padding-bottom so empty trailing space doesn't add pages
        return total + padTop + 4; // +4px buffer
    }

    // ── Overlay: draw page-break rulers OUTSIDE ql-editor ────────────
    _drawOverlay(contentH, pageCount) {
        this._overlay.innerHTML = '';
        if (pageCount <= 1) return;

        // Top of content inside wrapper = toolbar height (if any) + editor padding-top
        const editorEl = this.quill.root;
        const style    = getComputedStyle(editorEl);
        const padTop   = parseFloat(style.paddingTop) || 0;

        // The editorHost starts at top of pageWrapper (position relative)
        // Overlay is absolute over the pageWrapper
        const hostRect    = this._editorHost.getBoundingClientRect();
        const wrapRect    = this._pageWrapper.getBoundingClientRect();
        const hostTopInWrap = hostRect.top - wrapRect.top;

        for (let i = 1; i < pageCount; i++) {
            const breakY = hostTopInWrap + padTop + this._usableH * i;

            const ruler = document.createElement('div');
            ruler.className    = 'qp-ruler';
            ruler.style.top    = `${breakY}px`;

            if (this.config.showPageNumbers) {
                const lbl       = document.createElement('span');
                lbl.className   = 'qp-ruler-label';
                lbl.textContent = `Page ${i + 1}`;
                ruler.appendChild(lbl);
            }

            this._overlay.appendChild(ruler);
        }
    }

    // ── Page Content Management (Single Instance) ────────────────────
    
    // Calculate precise text boundaries for visual pages using block elements
    _getPageSlices() {
        const pageStarts = [];
        const lines = this.quill.getLines();
        for (let i = 0; i < this.pageCount; i++) {
            const minTop = i * this._usableH;
            let startIdx = -1;
            for (let line of lines) {
                const offset = this.quill.getIndex(line);
                const bounds = this.quill.getBounds(offset);
                if (bounds && bounds.top >= minTop) {
                    startIdx = offset;
                    break;
                }
            }
            pageStarts.push(startIdx === -1 ? this.quill.getLength() : startIdx);
        }
        pageStarts.push(this.quill.getLength()); // Final bound is end of document
        
        // Ensure monotonically increasing
        for (let i = 1; i < pageStarts.length; i++) {
            if (pageStarts[i] < pageStarts[i-1]) pageStarts[i] = pageStarts[i-1];
        }
        
        const slices = [];
        for (let i = 0; i < this.pageCount; i++) {
            slices.push({
                page: i,
                start: pageStarts[i],
                length: pageStarts[i+1] - pageStarts[i]
            });
        }
        return slices;
    }

    removePage(index) {
        if (index < 0 || index >= this.pageCount) return;
        const slices = this._getPageSlices();
        const slice = slices.find(s => s.page === index);
        
        if (slice && slice.length > 0) {
            this.quill.deleteText(slice.start, slice.length, 'user');
        }
    }

    movePages(sourceIndices, targetIndex) {
        if (!sourceIndices.length) return;
        const slices = this._getPageSlices();
        
        const pagesData = slices.map(s => ({
            page: s.page,
            delta: s.length > 0 ? this.quill.getContents(s.start, s.length) : null
        }));

        const sources = pagesData.filter(pd => sourceIndices.includes(pd.page));
        const others  = pagesData.filter(pd => !sourceIndices.includes(pd.page));
        
        let insertPos = others.findIndex(pd => pd.page === targetIndex);
        if (insertPos === -1) insertPos = others.length;
        
        // Insert sources at target position
        others.splice(insertPos, 0, ...sources);
        
        // Rebuild full document delta natively
        const finalOps = [];
        for (const data of others) {
            if (data.delta && data.delta.ops) finalOps.push(...data.delta.ops);
        }
        
        this.quill.setContents({ ops: finalOps }, 'user');
    }

    // ── Legacy compat stubs ──────────────────────────────────────────
    createPage() { return null; }
    checkPageOverflow() { this._repaginate(); }

    _syncCompat() {
        this.pages = [];
        for (let i = 0; i < this.pageCount; i++) {
            this.pages.push({ element: this._editorHost, quill: this.quill });
        }
        this.quillInstances = [this.quill];
        this.focusedQuill   = this.quill;
    }

    _updateCurrentPage() {
        const range = this.quill.getSelection();
        if (!range) return;
        try {
            const b = this.quill.getBounds(range.index);
            this.currentPageIndex = Math.max(0,
                Math.min(Math.floor(b.top / this._usableH), this.pageCount - 1));
        } catch (_) {}
    }

    _updateBadge() {
        const badge = document.getElementById('pageCountBadge');
        if (badge) badge.textContent = this.pageCount;
        const qsP = document.getElementById('qsPage');
        if (qsP) qsP.textContent = `Page ${this.currentPageIndex + 1} of ${this.pageCount}`;
    }

    // ── Upload / base64 ──────────────────────────────────────────────
    async _uploadOrBase64(file) {
        try {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
            const fd   = new FormData();
            fd.append('file', file);
            fd.append('type', 'image');
            const res  = await fetch('/upload_bp/api/image/upload', {
                method:  'POST',
                headers: csrf ? { 'X-CSRFToken': csrf } : {},
                body:    fd,
            });
            if (res.ok) {
                const d = await res.json();
                if (d.url || d.file_url) return d.url || d.file_url;
            }
        } catch (_) {}
        return new Promise(resolve => {
            const r = new FileReader();
            r.onload  = e => resolve(e.target.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(file);
        });
    }

    // ── Styles ───────────────────────────────────────────────────────
    _injectStyles() {
        const ID = 'qp-styles-v4';
        if (document.getElementById(ID)) return;

        const pageH  = this._pageH;
        const padPx  = this._padPx;
        const pageW  = this.config.pageWidth;

        const s   = document.createElement('style');
        s.id      = ID;
        s.textContent = `
        /* ── Canvas (transparent background) ─────────────────────────── */
        .qp-canvas {
            background:      transparent;
            min-height:      100%;
            padding:         32px 20px 80px;
            display:         flex;
            justify-content: center;
            box-sizing:      border-box;
        }

        /* ── White A4 paper ────────────────────────────────────── */
        .qp-page {
            position:      relative;
            width:         ${pageW};
            max-width:     100%;
            min-height:    ${pageH}px;
            background:    #fff;
            box-shadow:    0 1px 4px rgba(0,0,0,.13),
                           0 6px 20px rgba(0,0,0,.09),
                           0 12px 40px rgba(0,0,0,.05);
            border-radius: 2px;
            /* height is set dynamically by JS */
        }

        /* ── Quill host ─────────────────────────────────────────── */
        .qp-host { position: relative; z-index: 1; }
        .qp-host .ql-container.ql-snow { border: none; }
        .qp-host .ql-editor {
            /* NO min-height here — that's what avoids the loop */
            padding:     ${padPx}px;
            font-family: 'Times New Roman', Georgia, serif;
            font-size:   12pt;
            line-height: 1.75;
            color:       #1a1a1a;
            outline:     none;
        }
        .qp-host .ql-editor p { margin: 0 0 6pt; }
        .qp-host .ql-editor.ql-blank::before {
            font-style: italic;
            color: #9ca3af;
            left: ${padPx}px;
        }

        /* ── Overlay (page-break rulers) ───────────────────────── */
        .qp-overlay {
            position:       absolute;
            top:            0; left: 0;
            width:          100%; height: 100%;
            pointer-events: none;
            z-index:        5;
            overflow:       hidden;
        }

        /* ── Page-break ruler ───────────────────────────────────── */
        .qp-ruler {
            position:        absolute;
            left:            0; right: 0;
            height:          26px;
            background:      #E8EAED;
            border-top:      2px solid #C5C9CD;
            border-bottom:   2px solid #C5C9CD;
            display:         flex;
            align-items:     center;
            justify-content: flex-end;
            padding-right:   14px;
            box-sizing:      border-box;
            transform:       translateY(-13px);
        }
        .qp-ruler-label {
            font-family:    Arial, sans-serif;
            font-size:      9px;
            font-weight:    600;
            color:          #80868B;
            text-transform: uppercase;
            letter-spacing: .8px;
            user-select:    none;
        }

        /* ── Images ─────────────────────────────────────────────── */
        .ql-editor img            { max-width:100%; height:auto; display:block; }
        .ql-editor img.align-left { float:left;  margin:4px 16px 8px 0; }
        .ql-editor img.align-right{ float:right; margin:4px 0 8px 16px; }
        .ql-editor img.align-center{ margin:8px auto; }

        /* ── Print ──────────────────────────────────────────────── */
        @media print {
            .qp-canvas  { background:white; padding:0; }
            .qp-page    { box-shadow:none; min-height:0; }
            .qp-ruler   { background:transparent; border-color:transparent;
                          page-break-after:always; height:0; }
            .qp-ruler-label { display:none; }
        }

        /* ── Mobile ─────────────────────────────────────────────── */
        @media (max-width:900px) {
            .qp-page { width:100%; }
            .qp-host .ql-editor { padding: 20mm 15mm; }
        }
        `;
        document.head.appendChild(s);
    }

    // ── Helpers ──────────────────────────────────────────────────────
    _mmToPx(mm) { return mm * 3.7795275591; }
    _getUsableHeight() { return this._usableH; }

    // ── Public API ───────────────────────────────────────────────────
    getPageCount()    { return this.pageCount; }
    getFocusedQuill() { return this.quill; }
    getQuill()        { return this.quill; } // Alias for compatibility
    getText()         { return this.quill.getText(); }
    getHTML()         { return this.quill.root.innerHTML; }
    getAllContent()    { return this.quill.getContents(); }

    exportContent() {
        return {
            delta: this.quill.getContents(),
            pages: this.pageCount,
            text:  this.quill.getText(),
            html:  this.quill.root.innerHTML,
        };
    }

    importContent(data) {
        if (!data?.delta) return;
        this._prevContentH = 0;   // reset so next repaginate runs
        this.quill.setContents(data.delta, 'silent');
        setTimeout(() => this._repaginate(), 250);
    }

    setAllContent(delta) {
        this._prevContentH = 0;
        this.quill.setContents(delta, 'silent');
        setTimeout(() => this._repaginate(), 250);
    }

    destroy() {
        clearTimeout(this._paginateTimer);
        this.quill.disable();
        this.container.innerHTML = '';
    }
}

window.QuillPagination = QuillPagination;
