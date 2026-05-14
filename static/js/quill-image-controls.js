// ===================================================================
// QUILL IMAGE CONTROLS - GLOBAL MANAGER (SOLUCIÓN FINAL)
// Un solo manejador para TODAS las imágenes en TODAS las páginas
// ===================================================================

(function() {
    'use strict';

    // SINGLETON GLOBAL - Solo una instancia en toda la aplicación
    if (window.GlobalImageControls) {
        console.log('⚠️ GlobalImageControls ya existe');
        return;
    }

    class GlobalImageControls {
        constructor() {
            this.selectedImage = null;
            this.currentQuill = null;
            this.overlay = null;
            this.isResizing = false;
            this.startX = 0;
            this.startY = 0;
            this.startWidth = 0;
            this.startHeight = 0;
            
            console.log('✅ GlobalImageControls inicializando...');
            this.init();
        }

        init() {
            this.injectStyles();
            this.setupGlobalClickHandler();
            this.setupKeyboardShortcuts();
            console.log('✅ GlobalImageControls listo');
        }

        injectStyles() {
            const styleId = 'global-image-controls-styles';
            if (document.getElementById(styleId)) return;

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                /* Overlay de selección */
                .global-image-overlay {
                    position: absolute;
                    border: 3px solid #3B82F6;
                    box-sizing: border-box;
                    pointer-events: none;
                    z-index: 9999;
                    background: rgba(59, 130, 246, 0.05);
                }

                /* Handles de resize */
                .global-image-handle {
                    position: absolute;
                    width: 14px;
                    height: 14px;
                    background: white;
                    border: 2px solid #3B82F6;
                    border-radius: 50%;
                    pointer-events: all;
                    cursor: nwse-resize;
                    z-index: 10000;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }

                .global-image-handle.nw { top: -7px; left: -7px; cursor: nw-resize; }
                .global-image-handle.ne { top: -7px; right: -7px; cursor: ne-resize; }
                .global-image-handle.sw { bottom: -7px; left: -7px; cursor: sw-resize; }
                .global-image-handle.se { bottom: -7px; right: -7px; cursor: se-resize; }

                /* Toolbar flotante */
                .global-image-toolbar {
                    position: absolute;
                    top: -50px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: white;
                    border: 1px solid #E5E7EB;
                    border-radius: 8px;
                    padding: 8px;
                    display: flex;
                    gap: 6px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
                    z-index: 10001;
                    pointer-events: all;
                }

                .global-image-toolbar button {
                    width: 38px;
                    height: 38px;
                    border: none;
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                    padding: 8px;
                }

                .global-image-toolbar button:hover {
                    background: #F3F4F6;
                    transform: scale(1.05);
                }

                .global-image-toolbar button:active {
                    transform: scale(0.95);
                }

                .global-image-toolbar button svg {
                    width: 22px;
                    height: 22px;
                }

                /* Alineación de imágenes */
                .ql-editor img.align-left {
                    float: left;
                    margin: 0 20px 10px 0;
                }

                .ql-editor img.align-right {
                    float: right;
                    margin: 0 0 10px 20px;
                }

                .ql-editor img.align-center {
                    display: block;
                    margin: 10px auto;
                }

                /* Modal de recorte */
                .global-crop-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.85);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    z-index: 100000;
                }

                .global-crop-modal.active {
                    display: flex;
                }

                .global-crop-container {
                    background: white;
                    border-radius: 12px;
                    padding: 24px;
                    max-width: 90vw;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .global-crop-canvas-wrapper {
                    position: relative;
                    overflow: auto;
                    max-height: 65vh;
                    border: 2px solid #E5E7EB;
                    border-radius: 8px;
                    background: #F9FAFB;
                }

                .global-crop-canvas {
                    display: block;
                    max-width: 100%;
                    cursor: crosshair;
                }

                .global-crop-selection {
                    position: absolute;
                    border: 3px dashed #3B82F6;
                    background: rgba(59, 130, 246, 0.15);
                    pointer-events: none;
                }

                .global-crop-controls {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                .global-crop-controls button {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 14px;
                    transition: all 0.2s;
                }

                .global-crop-controls .btn-cancel {
                    background: #F3F4F6;
                    color: #374151;
                }

                .global-crop-controls .btn-cancel:hover {
                    background: #E5E7EB;
                }

                .global-crop-controls .btn-crop {
                    background: #3B82F6;
                    color: white;
                }

                .global-crop-controls .btn-crop:hover {
                    background: #2563EB;
                }
            `;
            document.head.appendChild(style);
        }

        setupGlobalClickHandler() {
            // UN SOLO click handler para TODA la aplicación
            document.addEventListener('click', (e) => {
                const target = e.target;

                // Click en imagen dentro de Quill
                if (target.tagName === 'IMG' && target.closest('.ql-editor')) {
                    e.preventDefault();
                    this.selectImage(target);
                    return;
                }

                // Click en toolbar - no hacer nada
                if (target.closest('.global-image-toolbar')) {
                    return;
                }

                // Click en modal - no hacer nada
                if (target.closest('.global-crop-modal')) {
                    return;
                }

                // Click fuera - deseleccionar
                if (!target.closest('.ql-editor')) {
                    this.deselectImage();
                }
            }, true);

            console.log('✅ Click handler global registrado');
        }

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (!this.selectedImage) return;

                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (!e.target.closest('.ql-editor')) {
                        e.preventDefault();
                        this.deleteImage();
                    }
                }

                if (e.key === 'Escape') {
                    this.deselectImage();
                }
            });
        }

        selectImage(img) {
            console.log('📷 Imagen seleccionada');
            
            this.deselectImage();
            this.selectedImage = img;
            
            // Encontrar el Quill instance
            const editorEl = img.closest('.ql-editor');
            if (editorEl && typeof Quill !== 'undefined') {
                this.currentQuill = Quill.find(editorEl);
            }
            
            this.createOverlay();
        }

        deselectImage() {
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
            this.selectedImage = null;
            this.currentQuill = null;
        }

        createOverlay() {
            if (!this.selectedImage) return;

            const img = this.selectedImage;
            const rect = img.getBoundingClientRect();
            
            // Crear overlay
            this.overlay = document.createElement('div');
            this.overlay.className = 'global-image-overlay';
            
            // Posicionar relativo al viewport
            this.overlay.style.position = 'fixed';
            this.overlay.style.top = `${rect.top}px`;
            this.overlay.style.left = `${rect.left}px`;
            this.overlay.style.width = `${rect.width}px`;
            this.overlay.style.height = `${rect.height}px`;

            // Crear handles
            ['nw', 'ne', 'sw', 'se'].forEach(pos => {
                const handle = document.createElement('div');
                handle.className = `global-image-handle ${pos}`;
                handle.addEventListener('mousedown', (e) => this.startResize(e, pos));
                this.overlay.appendChild(handle);
            });

            // Crear toolbar
            const toolbar = this.createToolbar();
            this.overlay.appendChild(toolbar);

            document.body.appendChild(this.overlay);

            // Actualizar posición al scroll
            window.addEventListener('scroll', () => this.updateOverlayPosition(), true);
            window.addEventListener('resize', () => this.updateOverlayPosition());

            console.log('✅ Overlay creado');
        }

        updateOverlayPosition() {
            if (!this.overlay || !this.selectedImage) return;

            const rect = this.selectedImage.getBoundingClientRect();
            this.overlay.style.top = `${rect.top}px`;
            this.overlay.style.left = `${rect.left}px`;
            this.overlay.style.width = `${rect.width}px`;
            this.overlay.style.height = `${rect.height}px`;
        }

        createToolbar() {
            const toolbar = document.createElement('div');
            toolbar.className = 'global-image-toolbar';

            const buttons = [
                {
                    icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 7 3 12 8 17"/></svg>`,
                    title: 'Alinear Izquierda',
                    action: () => this.alignImage('left')
                },
                {
                    icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>`,
                    title: 'Centrar',
                    action: () => this.alignImage('center')
                },
                {
                    icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="16 7 21 12 16 17"/></svg>`,
                    title: 'Alinear Derecha',
                    action: () => this.alignImage('right')
                },
                {
                    icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
                    title: 'Recortar',
                    action: () => this.openCropModal()
                },
                {
                    icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
                    title: 'Eliminar',
                    action: () => this.deleteImage()
                }
            ];

            buttons.forEach(({ icon, title, action }) => {
                const btn = document.createElement('button');
                btn.innerHTML = icon;
                btn.title = title;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    action();
                });
                toolbar.appendChild(btn);
            });

            return toolbar;
        }

        startResize(e, position) {
            e.preventDefault();
            e.stopPropagation();

            this.isResizing = true;
            this.startX = e.clientX;
            this.startY = e.clientY;
            this.startWidth = this.selectedImage.offsetWidth;
            this.startHeight = this.selectedImage.offsetHeight;
            this.resizePosition = position;

            const onMove = (e) => this.handleResize(e);
            const onUp = () => {
                this.isResizing = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }

        handleResize(e) {
            if (!this.isResizing || !this.selectedImage) return;

            const deltaX = e.clientX - this.startX;
            const deltaY = e.clientY - this.startY;

            let newWidth = this.startWidth;
            let newHeight = this.startHeight;

            switch (this.resizePosition) {
                case 'se': newWidth += deltaX; newHeight += deltaY; break;
                case 'sw': newWidth -= deltaX; newHeight += deltaY; break;
                case 'ne': newWidth += deltaX; newHeight -= deltaY; break;
                case 'nw': newWidth -= deltaX; newHeight -= deltaY; break;
            }

            // Mantener proporción
            const aspectRatio = this.selectedImage.naturalWidth / this.selectedImage.naturalHeight;
            newHeight = newWidth / aspectRatio;

            // Límites
            newWidth = Math.max(50, Math.min(newWidth, 1200));
            newHeight = Math.max(50, Math.min(newHeight, 1200));

            this.selectedImage.style.width = `${newWidth}px`;
            this.selectedImage.style.height = `${newHeight}px`;

            this.updateOverlayPosition();
        }

        alignImage(alignment) {
            if (!this.selectedImage) return;

            this.selectedImage.classList.remove('align-left', 'align-center', 'align-right');
            
            if (alignment) {
                this.selectedImage.classList.add(`align-${alignment}`);
            }

            console.log(`✅ Imagen alineada: ${alignment}`);
            this.deselectImage();
        }

        openCropModal() {
            if (!this.selectedImage) return;

            const modal = document.createElement('div');
            modal.className = 'global-crop-modal active';

            const container = document.createElement('div');
            container.className = 'global-crop-container';

            const title = document.createElement('h3');
            title.textContent = 'Recortar Imagen';
            title.style.margin = '0 0 16px 0';
            title.style.fontSize = '20px';
            title.style.fontWeight = '600';
            container.appendChild(title);

            const canvasWrapper = document.createElement('div');
            canvasWrapper.className = 'global-crop-canvas-wrapper';

            const canvas = document.createElement('canvas');
            canvas.className = 'global-crop-canvas';
            canvasWrapper.appendChild(canvas);

            const selection = document.createElement('div');
            selection.className = 'global-crop-selection';
            selection.style.display = 'none';
            canvasWrapper.appendChild(selection);

            container.appendChild(canvasWrapper);

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = this.selectedImage.src;

            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
            };

            let cropData = null;
            let isSelecting = false;

            canvas.addEventListener('mousedown', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (e.clientY - rect.top) * (canvas.height / rect.height);

                cropData = { startX: x, startY: y, width: 0, height: 0 };
                isSelecting = true;
                selection.style.display = 'block';
            });

            canvas.addEventListener('mousemove', (e) => {
                if (!isSelecting) return;

                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) * (canvas.width / rect.width);
                const y = (e.clientY - rect.top) * (canvas.height / rect.height);

                cropData.width = x - cropData.startX;
                cropData.height = y - cropData.startY;

                const displayRect = canvas.getBoundingClientRect();
                const scaleX = displayRect.width / canvas.width;
                const scaleY = displayRect.height / canvas.height;

                selection.style.left = `${cropData.startX * scaleX}px`;
                selection.style.top = `${cropData.startY * scaleY}px`;
                selection.style.width = `${cropData.width * scaleX}px`;
                selection.style.height = `${cropData.height * scaleY}px`;
            });

            canvas.addEventListener('mouseup', () => {
                isSelecting = false;
            });

            const controls = document.createElement('div');
            controls.className = 'global-crop-controls';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn-cancel';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.addEventListener('click', () => modal.remove());

            const cropBtn = document.createElement('button');
            cropBtn.className = 'btn-crop';
            cropBtn.textContent = 'Recortar';
            cropBtn.addEventListener('click', () => {
                if (cropData && Math.abs(cropData.width) > 10 && Math.abs(cropData.height) > 10) {
                    this.applyCrop(canvas, cropData);
                    modal.remove();
                }
            });

            controls.appendChild(cancelBtn);
            controls.appendChild(cropBtn);
            container.appendChild(controls);

            modal.appendChild(container);
            document.body.appendChild(modal);

            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }

        applyCrop(sourceCanvas, cropData) {
            const x = cropData.width < 0 ? cropData.startX + cropData.width : cropData.startX;
            const y = cropData.height < 0 ? cropData.startY + cropData.height : cropData.startY;
            const width = Math.abs(cropData.width);
            const height = Math.abs(cropData.height);

            const croppedCanvas = document.createElement('canvas');
            croppedCanvas.width = width;
            croppedCanvas.height = height;
            const ctx = croppedCanvas.getContext('2d');

            ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);

            const croppedDataUrl = croppedCanvas.toDataURL('image/png');
            this.selectedImage.src = croppedDataUrl;
            this.selectedImage.style.width = '';
            this.selectedImage.style.height = '';

            console.log('✅ Imagen recortada');
            this.deselectImage();
        }

        deleteImage() {
            if (!this.selectedImage) return;
            
            const blot = Quill.find(this.selectedImage);
            if (blot) {
                // blot.offset() returns index relative to parent or scroll
                const index = blot.offset(blot.scroll);
                blot.scroll.deleteAt(index, 1);
            }
 
            console.log('✅ Imagen eliminada');
            this.deselectImage();
        }
    }

    // Crear instancia global cuando Quill esté listo
    function initGlobalControls() {
        if (typeof Quill !== 'undefined' && !window.GlobalImageControls) {
            window.GlobalImageControls = new GlobalImageControls();
            console.log('✅ GlobalImageControls inicializado');
        } else if (!window.GlobalImageControls) {
            setTimeout(initGlobalControls, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGlobalControls);
    } else {
        initGlobalControls();
    }

})();
