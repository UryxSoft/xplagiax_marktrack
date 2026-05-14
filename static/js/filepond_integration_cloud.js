// FilePond Integration for Storage Manager
// This file should be loaded after the main FilePond library

function initializeFilePond() {
    // Check if FilePond is available
    if (typeof FilePond === 'undefined') {
        console.warn('FilePond not available, falling back to basic file input');
        return;
    }

    // IMPORTANT: Check if FilePond was already initialized by filepond_upload_js.js
    // This prevents this file from overwriting the correct configuration
    if (typeof documentPond !== 'undefined' && documentPond !== null) {
        console.log('FilePond already initialized by filepond_upload_js.js, skipping...');
        return documentPond;
    }

    // Register FilePond plugins if available
    if (typeof FilePondPluginImagePreview !== 'undefined') {
        FilePond.registerPlugin(FilePondPluginImagePreview);
    }
    if (typeof FilePondPluginFileValidateType !== 'undefined') {
        FilePond.registerPlugin(FilePondPluginFileValidateType);
    }
    if (typeof FilePondPluginFileValidateSize !== 'undefined') {
        FilePond.registerPlugin(FilePondPluginFileValidateSize);
    }

    // Initialize FilePond
    const inputElement = document.querySelector('#document-filepond');
    if (!inputElement) return;

    const pond = FilePond.create(inputElement, {
        name: 'file',  // Field name expected by backend
        allowMultiple: false,
        maxFileSize: '10MB',
        acceptedFileTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/epub+zip',
            'application/x-mobipocket-ebook'
        ],
        labelIdle: `
            <div style="text-align: center; padding: 1rem;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem; color: var(--primary);">
                    <i class="bi bi-cloud-upload"></i>
                </div>
                <div style="font-weight: 600; margin-bottom: 0.25rem;">
                    Drag & Drop your document or <span class="filepond--label-action">Browse</span>
                </div>
                <div style="font-size: 0.875rem; color: #666;">
                    Supports PDF, DOCX, DOC, TXT, EPUB, MOBI
                </div>
            </div>
        `,
        labelFileProcessing: 'Uploading...',
        labelFileProcessingComplete: 'Upload complete',
        labelFileProcessingAborted: 'Upload cancelled',
        labelFileProcessingRevert: 'Undo',
        labelTapToCancel: 'tap to cancel',
        labelTapToRetry: 'tap to retry',
        labelTapToUndo: 'tap to undo',

        server: {
            process: {
                url: '/x_buck/api/files',
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                },
                onload: function (response) {
                    try {
                        const data = JSON.parse(response);
                        if (data.success) {
                            showUploadSuccess(data);
                            return data.file_id || data.id;
                        } else {
                            throw new Error(data.message || 'Upload failed');
                        }
                    } catch (e) {
                        showUploadError(e.message);
                        throw e;
                    }
                },
                onerror: function (response) {
                    console.error('Upload error:', response);
                    showUploadError('Upload failed. Please try again.');
                }
            }
        },

        onaddfile: function (error, file) {
            if (error) {
                console.error('File add error:', error);
                return;
            }

            // Detect file type and update UI
            detectAndUpdateFileType(file.file);
        },

        onprocessfile: function (error, file) {
            if (error) {
                console.error('Process error:', error);
                showUploadError('Upload failed: ' + error.body);
                return;
            }

            // File uploaded successfully
            setTimeout(() => {
                closeModals();
                // Refresh the current storage view
                if (window.storageManager) {
                    window.storageManager.loadStorageContent(window.storageManager.currentStorage);
                }
            }, 1000);
        }
    });

    return pond;
}

function detectAndUpdateFileType(file) {
    const typeDetectionContainer = document.getElementById('type-detection-container');
    const documentTypeOptions = document.querySelectorAll('.document-type-option');

    if (!file || !typeDetectionContainer) return;

    // Reset all options
    documentTypeOptions.forEach(option => {
        option.classList.remove('active');
    });

    // Detect file type
    const fileName = file.name.toLowerCase();
    let detectedType = '';

    if (fileName.endsWith('.pdf')) {
        detectedType = 'pdf';
    } else if (fileName.endsWith('.docx')) {
        detectedType = 'docx';
    } else if (fileName.endsWith('.doc')) {
        detectedType = 'doc';
    } else if (fileName.endsWith('.txt')) {
        detectedType = 'txt';
    } else if (fileName.endsWith('.epub')) {
        detectedType = 'epub';
    } else if (fileName.endsWith('.mobi')) {
        detectedType = 'mobi';
    }

    if (detectedType) {
        const option = document.querySelector(`[data-type="${detectedType}"]`);
        if (option) {
            option.classList.add('active');
        }

        // Add detected type styling
        typeDetectionContainer.className = `detected-type-container ${detectedType}-detected`;

        // Update FilePond container styling
        const filePondContainer = document.getElementById('document-filepond-container');
        if (filePondContainer) {
            filePondContainer.className = `mb-4 document-type-${detectedType}-active`;
        }
    }
}

function showUploadSuccess(data) {
    const statusDiv = document.getElementById('uploadStatus');
    const icon = document.getElementById('uploadStatusIcon');
    const text = document.getElementById('uploadStatusText');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');
    const stageText = document.getElementById('uploadStageText');

    if (statusDiv && icon && text) {
        statusDiv.classList.remove('d-none');
        statusDiv.className = 'alert alert-success';

        icon.className = 'bi bi-check-circle';
        text.textContent = 'Document uploaded successfully!';

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '100%';
        if (stageText) stageText.textContent = 'Complete';

        // Show success message globally
        if (window.showSuccess) {
            window.showSuccess(`Document "${data.filename || 'file'}" uploaded successfully`);
        }
    }
}

function showUploadError(message) {
    const statusDiv = document.getElementById('uploadStatus');
    const icon = document.getElementById('uploadStatusIcon');
    const text = document.getElementById('uploadStatusText');

    if (statusDiv && icon && text) {
        statusDiv.classList.remove('d-none');
        statusDiv.className = 'alert alert-danger';

        icon.className = 'bi bi-exclamation-triangle';
        text.textContent = message || 'Upload failed';

        // Show error message globally
        if (window.showError) {
            window.showError(message || 'Upload failed');
        }
    }
}

function closeModals() {
    const modals = document.querySelectorAll('.upload-modal');
    modals.forEach(modal => {
        modal.classList.remove('active');
    });
    document.body.style.overflow = '';

    // Reset upload status
    const statusDiv = document.getElementById('uploadStatus');
    if (statusDiv) {
        statusDiv.classList.add('d-none');
    }

    // Reset file type detection
    const typeDetectionContainer = document.getElementById('type-detection-container');
    const documentTypeOptions = document.querySelectorAll('.document-type-option');

    if (typeDetectionContainer) {
        typeDetectionContainer.className = '';
    }

    documentTypeOptions.forEach(option => {
        option.classList.remove('active');
    });

    const filePondContainer = document.getElementById('document-filepond-container');
    if (filePondContainer) {
        filePondContainer.className = 'mb-4';
    }
}

// Initialize FilePond when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    // Wait for other scripts to load
    setTimeout(() => {
        const pond = initializeFilePond();

        // Setup upload form submission
        const uploadForm = document.getElementById('documentUploadForm');
        const submitButton = document.getElementById('submitDocumentUpload');

        if (submitButton) {
            submitButton.addEventListener('click', function (e) {
                e.preventDefault();

                if (pond && pond.getFiles().length > 0) {
                    // FilePond will handle the upload automatically
                    pond.processFiles();
                } else {
                    showUploadError('Please select a file to upload');
                }
            });
        }

        // Setup document type option clicks
        const documentTypeOptions = document.querySelectorAll('.document-type-option');
        documentTypeOptions.forEach(option => {
            option.addEventListener('click', function () {
                // Remove active class from all options
                documentTypeOptions.forEach(opt => opt.classList.remove('active'));

                // Add active class to clicked option
                this.classList.add('active');

                // Update container styling
                const type = this.getAttribute('data-type');
                const container = document.getElementById('type-detection-container');
                const filePondContainer = document.getElementById('document-filepond-container');

                if (container) {
                    container.className = `detected-type-container ${type}-detected`;
                }

                if (filePondContainer) {
                    filePondContainer.className = `mb-4 document-type-${type}-active`;
                }
            });
        });

    }, 500);
});

// Export functions for global access
window.initializeFilePond = initializeFilePond;
window.detectAndUpdateFileType = detectAndUpdateFileType;
window.showUploadSuccess = showUploadSuccess;
window.showUploadError = showUploadError;