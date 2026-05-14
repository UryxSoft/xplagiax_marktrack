/**
 * ============================================
 * UPLOAD TOAST - Ultra-Professional Uploader
 * Google Drive / Dropbox Style 2026
 * ============================================
 */

class UploadToast {
    constructor(options = {}) {
        this.options = {
            endpoint: '/x_doc/uploadsave',
            fieldName: 'save_file',
            maxConcurrent: 3,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            allowedTypes: ['application/pdf', 'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain', 'application/epub+zip', 'application/x-mobipocket-ebook'],
            maxRetries: 3,
            retryDelay: 1000,
            ...options
        };

        // Cloud provider configuration
        this.PROVIDER_CONFIG = {
            google_drive: { name: 'Google Drive', icon: 'google-drive.svg', color: '#4285f4' },
            dropbox: { name: 'Dropbox', icon: 'dropbox.svg', color: '#0061fe' },
            box: { name: 'Box', icon: 'box.svg', color: '#0061d5' },
            onedrive: { name: 'OneDrive', icon: 'onedrive.png', color: '#0078d4' },
            pcloud: { name: 'pCloud', icon: 'pcloud.svg', color: '#20c4cb' },
            mega: { name: 'MEGA', icon: 'mega.svg', color: '#d9272e' },
            yandex: { name: 'Yandex Disk', icon: 'yandex.svg', color: '#ffcc00' }
        };

        this.files = [];
        this.activeUploads = 0;
        this.isExpanded = false;
        this.isVisible = false;
        this.totalBytes = 0;
        this.uploadedBytes = 0;
        this.currentProvider = null;

        this.init();
    }

    init() {
        this.createDOM();
        this.bindEvents();
        this.setupKeyboardShortcuts();
        this.setupPasteHandler();
        this.setupDragAndDrop();
    }

    // ============ DOM Creation ============
    createDOM() {
        this.container = document.createElement('div');
        this.container.className = 'upload-toast collapsed';
        this.container.innerHTML = `
            <div class="upload-toast-header">
                <div class="upload-toast-title">
                    <div class="upload-toast-title-icon">
                        <i class="bi bi-cloud-upload"></i>
                    </div>
                    <span class="upload-toast-title-text">Uploads</span>
                    <span class="upload-toast-provider-icon" style="display: none;"></span>
                    <span class="upload-toast-count" style="display: none;">0</span>
                </div>
                <div class="upload-toast-actions">
                    <button class="upload-toast-btn minimize" title="Minimize">
                        <i class="bi bi-dash"></i>
                    </button>
                    <button class="upload-toast-btn close" title="Close">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            </div>
            
            <div class="upload-toast-collapsed-content">
                <div class="upload-toast-progress-bar">
                    <div class="upload-toast-progress-fill" style="width: 0%"></div>
                </div>
                <div class="upload-toast-progress-text">
                    <span class="upload-toast-progress-status">Ready to upload</span>
                    <span class="upload-toast-progress-percent"></span>
                </div>
            </div>
            
            <div class="upload-toast-expanded-content" style="display: none;">
                <div class="upload-toast-dropzone" id="uploadToastDropzone">
                    <div class="upload-toast-dropzone-icon">
                        <i class="bi bi-cloud-arrow-up default-icon"></i>
                        <img class="cloud-provider-icon" src="" alt="" style="display: none;">
                    </div>
                    <div class="upload-toast-dropzone-text">Drag files here</div>
                    <div class="upload-toast-dropzone-hint">or click to browse • Max 10MB</div>
                    <input type="file" id="uploadToastFileInput" multiple accept=".pdf,.doc,.docx,.txt,.epub,.mobi" style="display: none;">
                </div>
                
                <div class="upload-toast-files" id="uploadToastFiles">
                    <div class="upload-toast-empty">
                        <div class="upload-toast-empty-icon"><i class="bi bi-inbox"></i></div>
                        <div class="upload-toast-empty-text">No files in queue</div>
                    </div>
                </div>
                
                <div class="upload-toast-footer" style="display: none;">
                    <div class="upload-toast-summary">
                        <span class="upload-toast-total">0 files</span>
                        <span class="upload-toast-size">0 MB</span>
                    </div>
                    <div class="upload-toast-batch-actions">
                        <button class="upload-toast-batch-btn pause" id="uploadToastPause">
                            <i class="bi bi-pause-fill"></i> Pause All
                        </button>
                        <button class="upload-toast-batch-btn cancel" id="uploadToastCancel">
                            <i class="bi bi-x"></i> Cancel All
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);

        // Cache DOM elements
        this.elements = {
            header: this.container.querySelector('.upload-toast-header'),
            titleText: this.container.querySelector('.upload-toast-title-text'),
            count: this.container.querySelector('.upload-toast-count'),
            minimizeBtn: this.container.querySelector('.upload-toast-btn.minimize'),
            closeBtn: this.container.querySelector('.upload-toast-btn.close'),
            collapsedContent: this.container.querySelector('.upload-toast-collapsed-content'),
            expandedContent: this.container.querySelector('.upload-toast-expanded-content'),
            progressFill: this.container.querySelector('.upload-toast-progress-fill'),
            progressStatus: this.container.querySelector('.upload-toast-progress-status'),
            progressPercent: this.container.querySelector('.upload-toast-progress-percent'),
            dropzone: this.container.querySelector('.upload-toast-dropzone'),
            dropzoneDefaultIcon: this.container.querySelector('.upload-toast-dropzone-icon .default-icon'),
            dropzoneProviderIcon: this.container.querySelector('.upload-toast-dropzone-icon .cloud-provider-icon'),
            dropzoneText: this.container.querySelector('.upload-toast-dropzone-text'),
            dropzoneHint: this.container.querySelector('.upload-toast-dropzone-hint'),
            titleIcon: this.container.querySelector('.upload-toast-title-icon'),
            titleProviderIcon: this.container.querySelector('.upload-toast-provider-icon'),
            fileInput: this.container.querySelector('#uploadToastFileInput'),
            filesList: this.container.querySelector('#uploadToastFiles'),
            footer: this.container.querySelector('.upload-toast-footer'),
            totalText: this.container.querySelector('.upload-toast-total'),
            sizeText: this.container.querySelector('.upload-toast-size'),
            pauseBtn: this.container.querySelector('#uploadToastPause'),
            cancelBtn: this.container.querySelector('#uploadToastCancel')
        };
    }

    // ============ Event Binding ============
    bindEvents() {
        // Header click to toggle expand/collapse
        this.elements.header.addEventListener('click', (e) => {
            if (!e.target.closest('.upload-toast-btn')) {
                this.toggle();
            }
        });

        // Minimize button - toggle minimize/restore
        this.elements.minimizeBtn.addEventListener('click', () => {
            if (this.container.classList.contains('minimized')) {
                // If minimized, restore to collapsed state
                this.restore();
            } else if (this.isExpanded) {
                // If expanded, collapse first
                this.collapse();
            } else {
                // If collapsed, minimize
                this.minimize();
            }
        });

        // Close button
        this.elements.closeBtn.addEventListener('click', () => {
            this.hide();
        });

        // Dropzone click
        this.elements.dropzone.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        // File input change
        this.elements.fileInput.addEventListener('change', (e) => {
            this.addFiles(Array.from(e.target.files));
            e.target.value = ''; // Reset for next selection
        });

        // Batch actions
        this.elements.pauseBtn.addEventListener('click', () => this.pauseAll());
        this.elements.cancelBtn.addEventListener('click', () => this.cancelAll());
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + U to open uploader
            if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
                e.preventDefault();
                this.show();
                this.expand();
            }

            // Escape to close/minimize
            if (e.key === 'Escape' && this.isVisible) {
                if (this.isExpanded) {
                    this.collapse();
                } else {
                    this.hide();
                }
            }
        });
    }

    setupPasteHandler() {
        document.addEventListener('paste', (e) => {
            if (!this.isVisible) return;

            const items = e.clipboardData?.items;
            if (!items) return;

            const files = [];
            for (const item of items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }

            if (files.length > 0) {
                e.preventDefault();
                this.addFiles(files);
            }
        });
    }

    setupDragAndDrop() {
        // Global drag/drop for when toast is visible
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.elements.dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        this.elements.dropzone.addEventListener('dragenter', () => {
            this.elements.dropzone.classList.add('drag-over');
        });

        this.elements.dropzone.addEventListener('dragleave', (e) => {
            if (!this.elements.dropzone.contains(e.relatedTarget)) {
                this.elements.dropzone.classList.remove('drag-over');
            }
        });

        this.elements.dropzone.addEventListener('drop', (e) => {
            this.elements.dropzone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            this.addFiles(files);
        });

        // Show toast when files dragged anywhere on page
        document.addEventListener('dragenter', (e) => {
            if (e.dataTransfer.types.includes('Files')) {
                this.show();
                this.expand();
            }
        });
    }

    // ============ Show/Hide Methods ============
    show() {
        if (this.isVisible) return;
        this.isVisible = true;
        this.container.classList.add('visible');

        // Update provider icon based on active cloud tab
        this.updateProviderIcon();
    }

    hide() {
        if (!this.isVisible) return;

        // Don't hide if uploads in progress
        if (this.activeUploads > 0) {
            this.collapse();
            return;
        }

        this.isVisible = false;
        this.container.classList.remove('visible');
        this.collapse();
    }

    toggle() {
        if (this.isExpanded) {
            this.collapse();
        } else {
            this.expand();
        }
    }

    expand() {
        this.isExpanded = true;
        this.container.classList.remove('collapsed');
        this.container.classList.add('expanded');
        this.elements.collapsedContent.style.display = 'none';
        this.elements.expandedContent.style.display = 'block';

        // Update provider icon when expanding
        this.updateProviderIcon();
    }

    collapse() {
        this.isExpanded = false;
        this.container.classList.remove('expanded');
        this.container.classList.add('collapsed');
        this.elements.collapsedContent.style.display = 'block';
        this.elements.expandedContent.style.display = 'none';
    }

    minimize() {
        this.container.classList.add('minimized');
    }

    restore() {
        this.container.classList.remove('minimized');
    }

    // ============ Cloud Provider Icon Management ============
    updateProviderIcon() {
        // Check if we're in a cloud storage tab
        const provider = window.activeCloudProvider;

        if (provider && this.PROVIDER_CONFIG[provider]) {
            this.currentProvider = provider;
            const config = this.PROVIDER_CONFIG[provider];

            // Update dropzone icon
            if (this.elements.dropzoneDefaultIcon) {
                this.elements.dropzoneDefaultIcon.style.display = 'none';
            }
            if (this.elements.dropzoneProviderIcon) {
                this.elements.dropzoneProviderIcon.src = `/static/img/svg/${config.icon}`;
                this.elements.dropzoneProviderIcon.alt = config.name;
                this.elements.dropzoneProviderIcon.style.display = 'block';
            }

            // Update dropzone text
            if (this.elements.dropzoneText) {
                this.elements.dropzoneText.textContent = `Drag files to upload to ${config.name}`;
            }

            // Show provider icon AFTER the "Uploads" text
            if (this.elements.titleProviderIcon) {
                this.elements.titleProviderIcon.innerHTML = `
                    <img src="/static/img/svg/${config.icon}" alt="${config.name}" class="title-provider-img">
                `;
                this.elements.titleProviderIcon.style.display = 'inline-flex';
                this.elements.titleProviderIcon.title = `Uploading to ${config.name}`;
            }

            // Add cloud provider class to container for styling
            this.container.classList.add('cloud-upload');
            this.container.dataset.provider = provider;
        } else {
            this.currentProvider = null;

            // Reset to default icon
            if (this.elements.dropzoneDefaultIcon) {
                this.elements.dropzoneDefaultIcon.style.display = 'block';
            }
            if (this.elements.dropzoneProviderIcon) {
                this.elements.dropzoneProviderIcon.style.display = 'none';
            }

            // Reset dropzone text
            if (this.elements.dropzoneText) {
                this.elements.dropzoneText.textContent = 'Drag files here';
            }

            // Hide provider icon after "Uploads" text
            if (this.elements.titleProviderIcon) {
                this.elements.titleProviderIcon.innerHTML = '';
                this.elements.titleProviderIcon.style.display = 'none';
            }

            // Remove cloud provider class
            this.container.classList.remove('cloud-upload');
            delete this.container.dataset.provider;
        }
    }


    // ============ File Management ============
    addFiles(fileList) {
        for (const file of fileList) {
            // Validate file
            const validation = this.validateFile(file);
            if (!validation.valid) {
                this.showNotification(validation.message, 'error');
                continue;
            }

            const fileObj = {
                id: this.generateId(),
                file: file,
                name: file.name,
                size: file.size,
                type: this.getFileType(file),
                status: 'queued', // queued, uploading, complete, error, paused
                progress: 0,
                uploadedBytes: 0,
                retries: 0,
                xhr: null
            };

            this.files.push(fileObj);
            this.totalBytes += file.size;
        }

        this.updateUI();
        this.processQueue();
    }

    validateFile(file) {
        if (file.size > this.options.maxFileSize) {
            return { valid: false, message: `${file.name} is too large (max ${this.formatBytes(this.options.maxFileSize)})` };
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const validExts = ['pdf', 'doc', 'docx', 'txt', 'epub', 'mobi'];
        if (!validExts.includes(ext)) {
            return { valid: false, message: `${file.name} has unsupported format` };
        }

        return { valid: true };
    }

    getFileType(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') return 'pdf';
        if (['doc', 'docx'].includes(ext)) return 'doc';
        if (ext === 'txt') return 'txt';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
        return 'other';
    }

    removeFile(id) {
        const index = this.files.findIndex(f => f.id === id);
        if (index > -1) {
            const file = this.files[index];

            // Cancel if uploading
            if (file.xhr) {
                file.xhr.abort();
            }

            this.totalBytes -= file.size;
            this.uploadedBytes -= file.uploadedBytes;
            this.files.splice(index, 1);

            if (file.status === 'uploading') {
                this.activeUploads--;
            }

            this.updateUI();
            this.processQueue();
        }
    }

    // ============ Upload Logic ============
    processQueue() {
        while (this.activeUploads < this.options.maxConcurrent) {
            const nextFile = this.files.find(f => f.status === 'queued');
            if (!nextFile) break;
            this.uploadFile(nextFile);
        }
    }

    uploadFile(fileObj) {
        fileObj.status = 'uploading';
        this.activeUploads++;
        this.updateUI();

        const formData = new FormData();
        formData.append(this.options.fieldName, fileObj.file);

        // Add user_id if available
        if (typeof currentUserData !== 'undefined' && currentUserData.id) {
            formData.append('user_id', currentUserData.id);
        }

        // Determine the upload endpoint based on current provider
        let uploadEndpoint = this.options.endpoint; // Default: local storage
        let useCloudUpload = false;

        // Check if we're uploading to a cloud provider
        const activeProvider = this.currentProvider || window.activeCloudProvider;
        if (activeProvider && this.PROVIDER_CONFIG[activeProvider]) {
            useCloudUpload = true;
            // Use cloud upload endpoint - matches route: /storage/file/upload/<provider>
            uploadEndpoint = `/x_integ/storage/file/upload/${activeProvider}`;

            // For cloud uploads, recreate FormData with correct field name 'file'
            const cloudFormData = new FormData();
            cloudFormData.append('file', fileObj.file);

            // Add parent_id (folder) if we're in a subfolder
            if (window.storageManager && window.storageManager.cloudFolderId) {
                cloudFormData.append('parent_id', window.storageManager.cloudFolderId);
            }

            // Replace formData reference for cloud upload
            fileObj.formData = cloudFormData;
        }

        const xhr = new XMLHttpRequest();
        fileObj.xhr = xhr;

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const prevUploaded = fileObj.uploadedBytes;
                fileObj.uploadedBytes = e.loaded;
                fileObj.progress = Math.round((e.loaded / e.total) * 100);
                this.uploadedBytes += (e.loaded - prevUploaded);
                this.updateUI();
            }
        };

        xhr.onload = () => {
            this.activeUploads--;

            if (xhr.status >= 200 && xhr.status < 300) {
                fileObj.status = 'complete';
                fileObj.progress = 100;
                this.onFileComplete(fileObj);
            } else {
                this.handleUploadError(fileObj, `Server error: ${xhr.status}`);
            }

            this.updateUI();
            this.processQueue();
            this.checkAllComplete();
        };

        xhr.onerror = () => {
            this.activeUploads--;
            this.handleUploadError(fileObj, 'Network error');
            this.updateUI();
            this.processQueue();
        };

        xhr.open('POST', uploadEndpoint, true);
        // Use cloudFormData for cloud uploads, otherwise use the standard formData
        xhr.send(useCloudUpload && fileObj.formData ? fileObj.formData : formData);
    }

    handleUploadError(fileObj, message) {
        if (fileObj.retries < this.options.maxRetries) {
            fileObj.retries++;
            fileObj.status = 'queued';

            // Exponential backoff
            const delay = this.options.retryDelay * Math.pow(2, fileObj.retries - 1);

            this.showNotification(`Retrying ${fileObj.name} (${fileObj.retries}/${this.options.maxRetries})`, 'warning');

            setTimeout(() => {
                this.processQueue();
            }, delay);
        } else {
            fileObj.status = 'error';
            fileObj.errorMessage = message;
            this.showNotification(`Failed to upload ${fileObj.name}`, 'error');
        }
    }

    retryFile(id) {
        const file = this.files.find(f => f.id === id);
        if (file && file.status === 'error') {
            file.status = 'queued';
            file.retries = 0;
            file.progress = 0;
            file.uploadedBytes = 0;
            this.updateUI();
            this.processQueue();
        }
    }

    pauseAll() {
        this.files.forEach(f => {
            if (f.status === 'uploading' && f.xhr) {
                f.xhr.abort();
                f.status = 'paused';
                this.activeUploads--;
            }
        });
        this.updateUI();
    }

    cancelAll() {
        this.files.forEach(f => {
            if (f.xhr) f.xhr.abort();
        });
        this.files = [];
        this.activeUploads = 0;
        this.totalBytes = 0;
        this.uploadedBytes = 0;
        this.updateUI();
    }

    // ============ UI Updates ============
    updateUI() {
        const total = this.files.length;
        const uploading = this.files.filter(f => f.status === 'uploading').length;
        const complete = this.files.filter(f => f.status === 'complete').length;
        const queued = this.files.filter(f => f.status === 'queued').length;

        // Update count badge
        if (total > 0) {
            this.elements.count.style.display = 'inline-block';
            this.elements.count.textContent = total;
        } else {
            this.elements.count.style.display = 'none';
        }

        // Update title
        if (uploading > 0) {
            this.elements.titleText.textContent = `Uploading ${uploading} file${uploading > 1 ? 's' : ''}...`;
        } else if (complete === total && total > 0) {
            this.elements.titleText.textContent = `${complete} file${complete > 1 ? 's' : ''} uploaded`;
        } else {
            this.elements.titleText.textContent = 'Uploads';
        }

        // Update overall progress
        const overallProgress = this.totalBytes > 0
            ? Math.round((this.uploadedBytes / this.totalBytes) * 100)
            : 0;

        this.elements.progressFill.style.width = `${overallProgress}%`;
        this.elements.progressPercent.textContent = total > 0 ? `${overallProgress}%` : '';

        if (uploading > 0) {
            this.elements.progressStatus.textContent = `${this.formatBytes(this.uploadedBytes)} / ${this.formatBytes(this.totalBytes)}`;
        } else if (complete === total && total > 0) {
            this.elements.progressStatus.textContent = 'All uploads complete';
        } else if (queued > 0) {
            this.elements.progressStatus.textContent = `${queued} file${queued > 1 ? 's' : ''} in queue`;
        } else {
            this.elements.progressStatus.textContent = 'Ready to upload';
        }

        // Update file list
        this.renderFileList();

        // Update footer
        if (total > 0) {
            this.elements.footer.style.display = 'block';
            this.elements.totalText.textContent = `${total} file${total > 1 ? 's' : ''}`;
            this.elements.sizeText.textContent = `${this.formatBytes(this.uploadedBytes)} / ${this.formatBytes(this.totalBytes)}`;
        } else {
            this.elements.footer.style.display = 'none';
        }
    }

    renderFileList() {
        if (this.files.length === 0) {
            this.elements.filesList.innerHTML = `
                <div class="upload-toast-empty">
                    <div class="upload-toast-empty-icon"><i class="bi bi-inbox"></i></div>
                    <div class="upload-toast-empty-text">No files in queue</div>
                </div>
            `;
            return;
        }

        this.elements.filesList.innerHTML = this.files.map(file => this.renderFileItem(file)).join('');

        // Bind file action events
        this.elements.filesList.querySelectorAll('.upload-file-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;

                if (action === 'cancel') this.removeFile(id);
                if (action === 'retry') this.retryFile(id);
            });
        });
    }

    renderFileItem(file) {
        const iconClass = `upload-file-icon ${file.type}`;
        const icon = this.getFileIcon(file.type);

        let statusHtml = '';
        let actionsHtml = '';

        switch (file.status) {
            case 'uploading':
                statusHtml = `
                    <div class="upload-file-progress">
                        <div class="upload-file-progress-fill" style="width: ${file.progress}%"></div>
                    </div>
                    <span>${file.progress}%</span>
                `;
                actionsHtml = `
                    <button class="upload-file-action cancel" data-id="${file.id}" data-action="cancel" title="Cancel">
                        <i class="bi bi-x"></i>
                    </button>
                `;
                break;

            case 'complete':
                statusHtml = `<span style="color: var(--upload-success);">Complete</span>`;
                actionsHtml = `
                    <div class="upload-file-success">
                        <i class="bi bi-check"></i>
                    </div>
                `;
                break;

            case 'error':
                statusHtml = `<span style="color: var(--upload-error);">${file.errorMessage || 'Failed'}</span>`;
                actionsHtml = `
                    <button class="upload-file-action retry" data-id="${file.id}" data-action="retry" title="Retry">
                        <i class="bi bi-arrow-clockwise"></i>
                    </button>
                    <button class="upload-file-action cancel" data-id="${file.id}" data-action="cancel" title="Remove">
                        <i class="bi bi-x"></i>
                    </button>
                `;
                break;

            case 'queued':
                statusHtml = `<span>In queue...</span>`;
                actionsHtml = `
                    <button class="upload-file-action cancel" data-id="${file.id}" data-action="cancel" title="Remove">
                        <i class="bi bi-x"></i>
                    </button>
                `;
                break;

            case 'paused':
                statusHtml = `<span>Paused</span>`;
                actionsHtml = `
                    <button class="upload-file-action retry" data-id="${file.id}" data-action="retry" title="Resume">
                        <i class="bi bi-play-fill"></i>
                    </button>
                    <button class="upload-file-action cancel" data-id="${file.id}" data-action="cancel" title="Remove">
                        <i class="bi bi-x"></i>
                    </button>
                `;
                break;
        }

        return `
            <div class="upload-file-item ${file.status}" data-id="${file.id}">
                <div class="${iconClass}">
                    <i class="${icon}"></i>
                </div>
                <div class="upload-file-info">
                    <div class="upload-file-name">${file.name}</div>
                    <div class="upload-file-status">
                        ${statusHtml}
                    </div>
                </div>
                <div class="upload-file-actions">
                    ${actionsHtml}
                </div>
            </div>
        `;
    }

    getFileIcon(type) {
        const icons = {
            pdf: 'bi bi-file-earmark-pdf-fill',
            doc: 'bi bi-file-earmark-word-fill',
            txt: 'bi bi-file-earmark-text-fill',
            image: 'bi bi-file-earmark-image-fill',
            other: 'bi bi-file-earmark-fill'
        };
        return icons[type] || icons.other;
    }

    // ============ Completion Effects ============
    onFileComplete(fileObj) {
        // Create micro confetti for this file
        this.createConfetti();

        // ── Immediately extract & cache preview text from the uploaded blob ──
        // This runs asynchronously so it never blocks the UI.
        // When loadDocuments() re-renders the grid, the text will already
        // be in DocumentPreviewService's in-memory cache.
        const ext = (fileObj.name || '').split('.').pop().toLowerCase();
        if (['doc', 'docx'].includes(ext) && fileObj.file && window.DocumentPreviewService) {
            // Parse the XHR response to get the server-assigned docId
            try {
                const xhr = fileObj.xhr;
                if (xhr && xhr.responseText) {
                    const resp = JSON.parse(xhr.responseText);
                    const docId = resp.id;
                    if (docId) {
                        window.DocumentPreviewService.cacheFromBlob(docId, fileObj.file, ext);
                    }
                }
            } catch (e) {
                // Silent — preview will fall back to lazy load from API
            }
        }
    }


    checkAllComplete() {
        const allComplete = this.files.length > 0 &&
            this.files.every(f => f.status === 'complete');

        if (allComplete) {
            this.showNotification(`${this.files.length} file${this.files.length > 1 ? 's' : ''} uploaded successfully!`, 'success');
            this.createCelebration();

            // Refresh document/cloud list based on current provider
            const activeProvider = this.currentProvider || window.activeCloudProvider;

            if (activeProvider && this.PROVIDER_CONFIG[activeProvider]) {
                // Refresh cloud storage content via StorageManager
                if (window.storageManager && typeof window.storageManager.loadStorageContent === 'function') {
                    setTimeout(() => {
                        window.storageManager.loadStorageContent(activeProvider, window.storageManager.cloudFolderId);
                    }, 500);
                }
            } else {
                // Refresh local document list
                if (typeof loadFolderContent === 'function') {
                    setTimeout(() => loadFolderContent(currentFolderId), 500);
                }
            }
        }
    }

    createConfetti() {
        const colors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9334e8'];
        const container = this.container;

        for (let i = 0; i < 15; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'upload-confetti';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.setProperty('--tx', `${(Math.random() - 0.5) * 100}px`);
            confetti.style.setProperty('--ty', `${(Math.random() - 0.5) * 100}px`);
            container.appendChild(confetti);

            setTimeout(() => confetti.remove(), 1000);
        }
    }

    createCelebration() {
        // Larger celebration effect
        for (let i = 0; i < 30; i++) {
            setTimeout(() => this.createConfetti(), i * 30);
        }
    }

    // ============ Notifications ============
    showNotification(message, type = 'info') {
        // Use existing toast system if available
        if (typeof showToast === 'function') {
            showToast(message, type);
            return;
        }

        console.log(`[UploadToast ${type}] ${message}`);
    }

    // ============ Utility Methods ============
    generateId() {
        return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// ============ Global Instance & Initialization ============
let uploadToast = null;

function initUploadToast() {
    if (!uploadToast) {
        uploadToast = new UploadToast();
    }
    return uploadToast;
}

// Open upload toast function (can be called from buttons)
function openUploadToast() {
    const toast = initUploadToast();
    toast.show();
    toast.expand();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize toast (hidden by default)
    initUploadToast();

    // Hook into existing upload buttons
    document.querySelectorAll('[data-action="upload-document"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openUploadToast();
        });
    });
});

// Export for global access
window.UploadToast = UploadToast;
window.openUploadToast = openUploadToast;
window.initUploadToast = initUploadToast;

// Make the instance available globally after initialization
document.addEventListener('DOMContentLoaded', () => {
    window.uploadToast = initUploadToast();
});
