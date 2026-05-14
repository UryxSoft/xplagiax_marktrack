/* quill-bubble-toolbar.js */

class QuillBubbleToolbar {
    constructor(quill, options = {}) {
        this.quill = quill;
        this.options = Object.assign({
            onRewrite: null
        }, options);

        this.toolbar = null;
        this.isActive = false;
        
        this._init();
    }

    _init() {
        this._createDOM();
        this._attachListeners();
        this._updateLucide();
    }

    _createDOM() {
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'qbt-toolbar';
        this.toolbar.id = 'qbt-floating-toolbar';
        
        this.toolbar.innerHTML = `
            <div class="qbt-group">
                <div class="qbt-dropdown" id="qbt-dropdown-para">
                    <span id="qbt-current-para">Paragraph</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    <div class="qbt-dropdown-menu">
                        <div class="qbt-dropdown-item" data-format="p">Paragraph</div>
                        <div class="qbt-dropdown-item" data-format="h1">Heading 1</div>
                        <div class="qbt-dropdown-item" data-format="h2">Heading 2</div>
                    </div>
                </div>
                <div class="qbt-divider"></div>
                <button class="qbt-btn" data-format="color" title="Color">
                    <div class="qbt-color-dot" style="background: #ffffff;"></div>
                    <span>Color</span>
                </button>
                <div class="qbt-divider"></div>
                <button class="qbt-btn qbt-btn-rewrite" id="qbt-rewrite-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
                    <span>Re-write</span>
                </button>
            </div>
            <div class="qbt-divider"></div>
            <div class="qbt-group">
                <button class="qbt-btn" data-format="bold" title="Bold (Ctrl+B)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
                </button>
                <button class="qbt-btn" data-format="italic" title="Italic (Ctrl+I)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
                </button>
                <button class="qbt-btn" data-format="underline" title="Underline (Ctrl+U)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
                </button>
                <button class="qbt-btn" data-format="link" title="Insert Link">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                <button class="qbt-btn" data-format="bullet" title="Bullet List">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                </button>
                <button class="qbt-btn" data-format="ordered" title="Ordered List">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
                </button>
            </div>
        `;
        
        document.body.appendChild(this.toolbar);
    }

    _attachListeners() {
        this.quill.on('selection-change', (range) => {
            if (range && range.length > 0) {
                this._show(range);
            } else {
                this._hide();
            }
        });

        // Hide when clicking outside
        document.addEventListener('mousedown', (e) => {
            if (!this.toolbar.contains(e.target) && !this.quill.root.contains(e.target)) {
                this._hide();
            }
        });

        // Toggle dropdown
        const dropdown = this.toolbar.querySelector('#qbt-dropdown-para');
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        // Formatting actions
        this.toolbar.querySelectorAll('.qbt-btn, .qbt-dropdown-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const format = btn.dataset.format;
                this._handleFormat(format, btn);
            });
        });

        // Rewrite action
        const rewriteBtn = this.toolbar.querySelector('#qbt-rewrite-btn');
        rewriteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.options.onRewrite) {
                const range = this.quill.getSelection();
                const text = this.quill.getText(range.index, range.length);
                this.options.onRewrite(text, range);
            } else {
                alert("AI Re-write coming soon!");
            }
        });
    }

    _show(range) {
        if (this.isActive && this._lastRange === JSON.stringify(range)) return;
        this._lastRange = JSON.stringify(range);

        // Get selection bounds
        const bounds = this.quill.getBounds(range.index, range.length);
        const editorRect = this.quill.root.getBoundingClientRect();
        
        // Calculate absolute position
        const top = editorRect.top + bounds.top + window.scrollY - this.toolbar.offsetHeight - 12;
        const left = editorRect.left + bounds.left + (bounds.width / 2) - (this.toolbar.offsetWidth / 2);
        
        this.toolbar.style.top = `${top}px`;
        this.toolbar.style.left = `${left}px`;
        
        this.toolbar.classList.add('active');
        this.isActive = true;
        this._updateStates();
    }

    _hide() {
        if (!this.isActive) return;
        this.toolbar.classList.remove('active');
        this.toolbar.querySelector('.qbt-dropdown')?.classList.remove('open');
        this.isActive = false;
        this._lastRange = null;
    }

    _handleFormat(format, btn) {
        const range = this.quill.getSelection(true);
        if (!range) return;

        switch(format) {
            case 'bold':
            case 'italic':
            case 'underline':
                const active = this.quill.getFormat(range)[format];
                this.quill.format(format, !active);
                break;
            case 'link':
                const currentLink = this.quill.getFormat(range).link;
                if (currentLink) {
                    this.quill.format('link', false);
                } else {
                    const url = prompt('Enter URL:');
                    if (url) this.quill.format('link', url);
                }
                break;
            case 'p':
                this.quill.format('header', false);
                break;
            case 'h1':
                this.quill.format('header', 1);
                break;
            case 'h2':
                this.quill.format('header', 2);
                break;
            case 'bullet':
            case 'ordered':
                const listType = this.quill.getFormat(range).list;
                this.quill.format('list', listType === format ? false : format);
                break;
            case 'color':
                const color = prompt('Enter color (hex or name):', '#ff0000');
                if (color) this.quill.format('color', color);
                break;
        }
        
        this._updateStates();
    }

    _updateStates() {
        const range = this.quill.getSelection();
        if (!range) return;
        const formats = this.quill.getFormat(range);
        
        this.toolbar.querySelectorAll('.qbt-btn').forEach(btn => {
            const format = btn.dataset.format;
            if (['bold', 'italic', 'underline'].includes(format)) {
                btn.classList.toggle('active', !!formats[format]);
            }
            if (format === 'bullet' || format === 'ordered') {
                btn.classList.toggle('active', formats.list === format);
            }
        });

        // Update Paragraph text
        const paraLabel = this.toolbar.querySelector('#qbt-current-para');
        if (formats.header === 1) paraLabel.textContent = 'Heading 1';
        else if (formats.header === 2) paraLabel.textContent = 'Heading 2';
        else paraLabel.textContent = 'Paragraph';
    }

    _updateLucide() {
        // If Lucide is available globally, trigger it for the toolbar
        if (window.lucide) {
            window.lucide.createIcons({
                attrs: {
                    class: ['lucide-icon']
                },
                nameAttr: 'data-lucide',
                root: this.toolbar
            });
        }
    }
}

window.QuillBubbleToolbar = QuillBubbleToolbar;
