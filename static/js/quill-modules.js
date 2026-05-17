/**
 * @module quill-modules
 * @description Central Quill plugin registry for MarkTrack.
 *
 * Architecture:
 *  - All external plugins are loaded as UMD scripts via CDN (no bundler required).
 *  - Each load is guarded: if the CDN fails, the module is silently skipped.
 *  - Native re-implementations replace packages that have no Quill v2 UMD build.
 *  - getQuillModules(screen) returns { registry, config } consumed by QuillPagination.
 *
 * Screen parameter:
 *  'invite'      → student editor (emoji, placeholder, autocomplete, focus, form, ...)
 *  'documentedit' → professor editor (table-better, blotFormatter, markdownToolbar, ...)
 *
 * Intentionally OMITTED (per design decision):
 *  - quill-find-replace-module  → conflicts with existing EditorFind (editor-find.js)
 *  - quill-html-edit-button     → incompatible with paginated DOM
 *  - quill-table-ui             → superseded by quill-table-better
 */

/* ─────────────────────────────────────────────────────────────────────────────
   NATIVE MODULE: QuillFocusModule
   Replaces npm package 'quill-focus' which has no Quill v2 UMD build.
   Adds/removes .ql-focused class on the editor root element.
───────────────────────────────────────────────────────────────────────────── */
class QuillFocusModule {
    constructor(quill /*, options */) {
        const root = quill.root;
        root.addEventListener('focus', () => root.classList.add('ql-focused'));
        root.addEventListener('blur',  () => root.classList.remove('ql-focused'));
    }
}

/* ─────────────────────────────────────────────────────────────────────────────
   NATIVE MODULE: QuillFormModule
   Replaces npm package 'quill-form' which has no Quill v2 UMD build.
   Intercepts the nearest form's submit event and serialises the Quill Delta
   into a hidden <input> so standard form submissions carry the content.
───────────────────────────────────────────────────────────────────────────── */
class QuillFormModule {
    constructor(quill, options = {}) {
        const selector   = options.formSelector || 'form';
        const fieldName  = options.fieldName    || 'quill_content';
        const htmlName   = options.htmlField    || 'quill_html';

        const form = quill.root.closest('form') || document.querySelector(selector);
        if (!form) return;

        // Hidden field for Delta JSON
        const deltaInput = document.createElement('input');
        deltaInput.type  = 'hidden';
        deltaInput.name  = fieldName;
        form.appendChild(deltaInput);

        // Hidden field for HTML (optional convenience)
        const htmlInput = document.createElement('input');
        htmlInput.type  = 'hidden';
        htmlInput.name  = htmlName;
        form.appendChild(htmlInput);

        form.addEventListener('submit', () => {
            deltaInput.value = JSON.stringify(quill.getContents());
            htmlInput.value  = quill.root.innerHTML;
        });
    }
}

/* ─────────────────────────────────────────────────────────────────────────────
   LOADER UTILITIES
───────────────────────────────────────────────────────────────────────────── */
function loadScript(url) {
    return new Promise((resolve) => {
        if (document.querySelector(`script[src="${url}"]`)) return resolve(true);
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = url;
        script.crossOrigin = 'anonymous'; 
        script.onload  = () => resolve(true);
        script.onerror = () => {
            console.warn(`[quill-modules] Failed to load script: ${url}`);
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

function loadLink(url) {
    return new Promise((resolve) => {
        if (document.querySelector(`link[href="${url}"]`)) return resolve(true);
        const link = document.createElement('link');
        link.rel  = 'stylesheet';
        link.href = url;
        link.crossOrigin = 'anonymous';
        link.onload  = () => resolve(true);
        link.onerror = () => {
            console.warn(`[quill-modules] Failed to load CSS: ${url}`);
            resolve(false);
        };
        document.head.appendChild(link);
    });
}

/* ─────────────────────────────────────────────────────────────────────────────
   PLACEHOLDER PICKER — floating dropdown attached to toolbar buttons
   Compatible with both quill-placeholder-module (@grainmarket) and fallback.
───────────────────────────────────────────────────────────────────────────── */
function _showPlaceholderPicker(quill, triggerEl) {
    // Remove any existing picker
    const existing = document.getElementById('ql-placeholder-picker');
    if (existing) { existing.remove(); return; }

    const placeholders = [
        { id: 'student_name',  label: '👤 Student Name',    example: '{{student_name}}'  },
        { id: 'date',          label: '📅 Date',            example: '{{date}}'           },
        { id: 'assignment',    label: '📝 Assignment Title', example: '{{assignment}}'    },
        { id: 'classroom',     label: '🏫 Classroom',        example: '{{classroom}}'     },
        { id: 'deadline',      label: '⏰ Deadline',         example: '{{deadline}}'      },
    ];

    const picker = document.createElement('div');
    picker.id = 'ql-placeholder-picker';
    picker.style.cssText = [
        'position:absolute',
        'z-index:9999',
        'background:rgba(18,24,38,.97)',
        'border:1px solid rgba(99,102,241,.5)',
        'border-radius:10px',
        'padding:6px',
        'min-width:200px',
        'box-shadow:0 8px 32px rgba(0,0,0,.45)',
        'backdrop-filter:blur(12px)',
        'font-family:Inter,sans-serif',
    ].join(';');

    // Header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);padding:4px 8px 6px;';
    hdr.textContent = 'Insert Variable';
    picker.appendChild(hdr);

    placeholders.forEach(p => {
        const item = document.createElement('button');
        item.type = 'button';
        item.style.cssText = [
            'display:flex','align-items:center','gap:8px','width:100%',
            'padding:7px 10px','border:none','border-radius:7px',
            'background:transparent','color:rgba(255,255,255,.82)',
            'font-size:12px','cursor:pointer','text-align:left',
            'transition:background 0.15s',
        ].join(';');
        item.onmouseover = () => item.style.background = 'rgba(99,102,241,.25)';
        item.onmouseout  = () => item.style.background = 'transparent';

        const labelSpan = document.createElement('span');
        labelSpan.style.flex = '1';
        labelSpan.textContent = p.label;

        const codeSpan = document.createElement('span');
        codeSpan.style.cssText = 'font-family:monospace;font-size:10px;color:rgba(99,102,241,.9);';
        codeSpan.textContent = p.example;

        item.appendChild(labelSpan);
        item.appendChild(codeSpan);

        item.addEventListener('mousedown', (e) => {
            e.preventDefault();  // prevent editor losing focus
            picker.remove();

            // Try native placeholder module API first
            const mod = quill.getModule('placeholder') ||
                        quill.getModule('modules/placeholder');
            let used = false;
            if (mod) {
                if (typeof mod.insertPlaceholder === 'function') {
                    mod.insertPlaceholder(p.id); used = true;
                } else if (typeof mod.addPlaceholder === 'function') {
                    mod.addPlaceholder(p.id, p.label.replace(/^\S+ /, '')); used = true;
                }
            }

            if (!used) {
                // Fallback: insert raw text
                const range = quill.getSelection(true);
                if (range) {
                    quill.insertText(range.index, p.example, 'user');
                    quill.setSelection(range.index + p.example.length, 0, 'user');
                }
            }
        });

        picker.appendChild(item);
    });

    // Position below trigger button
    document.body.appendChild(picker);
    const rect = triggerEl ? triggerEl.getBoundingClientRect() : { left: 100, bottom: 60 };
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const pickerW = picker.offsetWidth || 210;
    const left = Math.min(rect.left + scrollX, window.innerWidth - pickerW - 12);
    picker.style.top  = (rect.bottom + scrollY + 4) + 'px';
    picker.style.left = Math.max(8, left) + 'px';

    // Close on outside click
    const closeOutside = (e) => {
        if (!picker.contains(e.target) && e.target !== triggerEl) {
            picker.remove();
            document.removeEventListener('mousedown', closeOutside);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOutside), 10);
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────────────────────────────────────── */
export async function getQuillModules(screen) {
    /** registry: modules to Quill.register() before instantiation  */
    const registry = {};
    /** config:   modules block to pass to QuillPagination / new Quill() */
    const config   = {};

    /* ── 1. Register native modules immediately (no CDN needed) ─────────── */
    registry['modules/focus'] = QuillFocusModule;
    config.focus = true;

    registry['modules/form'] = QuillFormModule;
    // Only enable form module if there's actually a <form> on this page
    if (document.querySelector('form')) {
        config.form = {};
    }

    /* ── 2. SHARED MODULES (both screens) ─────────────────────────────────
       Load all in parallel, then register what was actually available.
    ──────────────────────────────────────────────────────────────────────── */
    const sharedLoads = await Promise.all([
        // quill-magic-url — auto-linkifies typed/pasted URLs
        loadScript('https://cdn.jsdelivr.net/npm/quill-magic-url@4.2.0/dist/index.min.js'),

        // quill-paste-smart has been intentionally disabled because it is fundamentally 
        // incompatible with Quill v2 and throws uncaught exceptions (e.preventDefault) 
        // on paste events, which breaks all subsequent event listeners and keyboard shortcuts.
        // Quill v2's native clipboard handles sanitization perfectly out of the box.

        // quill-table-better — actively maintained Quill v2 table module (shared)
        loadLink('https://cdn.jsdelivr.net/npm/quill-table-better@1.2.3/dist/quill-table-better.css'),
        loadScript('https://cdn.jsdelivr.net/npm/quill-table-better@1.2.3/dist/quill-table-better.js'),

        // quill-blot-formatter2 — official Quill v2 fork for image/video resizing
        loadScript('https://cdn.jsdelivr.net/npm/@enzedonline/quill-blot-formatter2@3.0.0/dist/index.js'),

        // quill-image-compress — compresses images before embedding
        loadScript('https://cdn.jsdelivr.net/npm/quill-image-compress@1.2.30/dist/quill.imageCompressor.min.js'),
    ]);


    // quill-magic-url: self-registers into Quill
    config.magicUrl = {
        globalRegularExpression: /(https?:\/\/|www\.)[\w-]+(\.[\w-]+)+([\w.,@?^=%&:/~+#\-_]*[\w@?^=%&/~+#\-_])?/gi,
        urlRegularExpression:    /(https?:\/\/[\w-]+(\.[\w-]+)+([\w.,@?^=%&:/~+#\-_]*[\w@?^=%&/~+#\-_])?)/gi,
    };

    // Standard Quill v2 clipboard config
    config.clipboard = {
        matchVisual: false
    };

    // quill-table-better
    // IMPORTANT: Do NOT manually Quill.register() this module; UMD build self-registers.
    if (window.QuillTableBetter) {
        config.table = false;
        config['table-better'] = {
            language: 'en_US',
            menus: ['column', 'row', 'merge', 'table', 'cell', 'wrap', 'delete'],
            toolbarTable: false,
        };
        console.log('[quill-modules] table-better: shared ✓');
    }

    // quill-blot-formatter2
    if (window.QuillBlotFormatter2 || window.BlotFormatter) {
        const BF = window.QuillBlotFormatter2 || window.BlotFormatter;
        try {
            registry['modules/blotFormatter2'] = BF.default || BF;
            config.blotFormatter2 = {
                overlay: {
                    style: {
                        border: '2px solid rgba(99,102,241,0.7)',
                    },
                },
                // Restrict to images and video — avoids conflict with custom-image-blot
                specs: [
                    (BF.ImageSpec)    ? BF.ImageSpec    : null,
                    (BF.VideoSpec)    ? BF.VideoSpec    : null,
                    (BF.IframeVideoSpec) ? BF.IframeVideoSpec : null,
                ].filter(Boolean),
            };
        } catch (e) {
            console.warn('[quill-modules] blotFormatter2 error:', e.message);
        }
    }

    // quill-image-compress
    const ImageCompress = window.imageCompressor || window.ImageCompress || window.QuillImageCompress;
    if (ImageCompress) {
        try {
            registry['modules/imageCompress'] = ImageCompress.default || ImageCompress;
            config.imageCompress = {
                quality:       0.75,
                maxWidth:      1200,
                maxHeight:     1200,
                imageType:     'image/webp',
                keepImageTypes: ['image/gif'],   // never compress GIFs
                debug:         false,
                suppressErrorLogging: false,
            };
        } catch (e) {
            console.warn('[quill-modules] imageCompress error:', e.message);
        }
    }


    /* ── 3. INVITE-ONLY MODULES ───────────────────────────────────────────
       Student editor extras.
    ──────────────────────────────────────────────────────────────────────── */

    /* ── 4. DOCUMENTEDIT-ONLY MODULES ────────────────────────────────────
       Professor editor extras (table, markdown, image-blot).
    ──────────────────────────────────────────────────────────────────────── */
    if (screen === 'documentedit') {
        const deLoads = await Promise.all([
            // quilljs-markdown — reliable markdown shortcuts for Quill v2
            loadLink('https://cdn.jsdelivr.net/npm/quilljs-markdown@1.2.0/dist/quilljs-markdown-common-style.css'),
            loadScript('https://cdn.jsdelivr.net/npm/quilljs-markdown@1.2.0/dist/quilljs-markdown.js'),

            // quill-markdown-toolbar — adds markdown-specific buttons to toolbar
            loadScript('https://cdn.jsdelivr.net/npm/quill-markdown-toolbar@0.1.2/dist/markdownToolbar.min.js'),
        ]);

        // quill-table-better (Professor specific config)
        if (window.QuillTableBetter) {
            config.table = false;
            config['table-better'] = {
                language: 'en_US',
                menus: ['column', 'row', 'merge', 'table', 'cell', 'wrap', 'delete'],
                toolbarTable: false,
            };
        }

        // quilljs-markdown
        const QuillMarkdown = window.QuillMarkdown;
        if (QuillMarkdown) {
            try {
                registry['modules/markdown'] = class {
                    constructor(quill, options) {
                        new QuillMarkdown(quill, options);
                    }
                };
                config.markdown = {};
            } catch (e) {
                console.warn('[quill-modules] markdown error:', e.message);
            }
        }

        const MdToolbar = window.QuillMarkdownToolbar || window.MarkdownToolbar;
        if (MdToolbar) {
            try {
                registry['modules/markdownToolbar'] = MdToolbar.default || MdToolbar;
                config.markdownToolbar = {};
            } catch (e) {
                console.warn('[quill-modules] markdownToolbar skipped:', e.message);
            }
        }
    }

    /* ── 5. TOOLBAR HANDLER FACTORIES ─────────────────────────────────────
       Each factory receives the quill instance and returns the actual handler
       function that Quill's toolbar.addHandler() will call.
       The calling code (invite-editor.js / documentedit_core.js) does:
         const toolbar = quill.getModule('toolbar');
         Object.entries(toolbarHandlerFactories).forEach(([name, factory]) =>
           toolbar.addHandler(name, factory(quill))
         );
    ──────────────────────────────────────────────────────────────────────── */
    const toolbarHandlerFactories = {};

    // Placeholder picker — both screens
    toolbarHandlerFactories['placeholder'] = (quill) => function () {
        const btn = this?.quill?.container
                        ?.closest('#custom-toolbar')
                        ?.querySelector('.ql-placeholder')
            || document.querySelector('.ql-placeholder');
        _showPlaceholderPicker(quill, btn);
    };

    toolbarHandlerFactories['table'] = (quill) => function () {
        const betterTable = quill.getModule('table-better');
        if (betterTable) {
            betterTable.insertTable(3, 3);
        } else {
            console.warn('[quill-modules] table-better not loaded; table insert skipped.');
        }
    };

    /* ── 6. RETURN ─────────────────────────────────────────────────────── */
    return { registry, config, toolbarHandlerFactories };
}
