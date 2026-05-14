// === CONFIG ===
        const MM_TO_PX = 3.779527559;
        const PAGE_CONTENT_HEIGHT_MM = 257;
        const PAGE_HEIGHT_PX = PAGE_CONTENT_HEIGHT_MM * MM_TO_PX;

        let currentPage = 1;
        let editors = {};
        let activeEditor = null;
        let currentDocumentId = null;
        let saveTimeout;
        let documents = [];
        let isSaving = false;
        let isSharedDocument = false;
        let sharedDocumentInfo = null;
        let currentUserEmail = 'anonymous';

        // === SOURCE BLOT ===
        const Inline = Quill.import('blots/inline');
        class SourceBlot extends Inline {
            static create(value) {
                const node = super.create();
                node.setAttribute('data-url', value.url);
                node.setAttribute('data-site', value.site);
                node.classList.add('source-highlight');
                return node;
            }
            static formats(node) {
                return { url: node.getAttribute('data-url'), site: node.getAttribute('data-site') };
            }
        }
        SourceBlot.blotName = 'source'; SourceBlot.tagName = 'span'; Quill.register(SourceBlot);

        // === QUILL EDITOR SETUP ===
        function createQuillEditor(containerId) {
            const quill = new Quill(`#${containerId}`, {
                modules: { toolbar: '#toolbar', history: { delay: 2000 } },
                theme: 'snow'
            });

            quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
                const html = node.outerHTML || '';
                const urlMatch = html.match(/https?:\/\/[^\s"']+/);
                let siteName = urlMatch ? new URL(urlMatch[0]).hostname.replace(/^www\./, '') : 'Web';
                if (siteName) {
                    delta.ops.forEach(op => {
                        if (op.insert && typeof op.insert === 'string') {
                            op.attributes = { ...op.attributes, source: { url: urlMatch?.[0] || '', site: siteName } };
                        }
                    });
                }
                return delta;
            });

            quill.on('text-change', () => {
                updateStats();
                checkPageOverflow(quill, getPageNumberFromEditor(quill));
                
                // Auto-save functionality
                if (currentDocumentId && !isReadonly()) {
                    clearTimeout(saveTimeout);
                    updateStatus('saving', 'Guardando...');
                    saveTimeout = setTimeout(() => {
                        saveDocument(false, true);
                    }, 2000);
                }
            });

            quill.on('selection-change', range => {
                if (range) {
                    activeEditor = quill;
                    updateCurrentPageDisplay(getPageNumberFromEditor(quill));
                }
            });

            if (isReadonly()) {
                quill.disable();
            }

            return quill;
        }

        // === PAGINATION ===
        function getPageNumberFromEditor(quill) {
            return parseInt(quill.container.closest('.page').id.split('-')[1]);
        }

        function createNewPage() {
            currentPage++;
            const newPage = document.createElement('div');
            newPage.className = 'page';
            newPage.id = `page-${currentPage}`;
            newPage.innerHTML = `
                <div class="page-number">${currentPage}</div>
                <div id="editor-${currentPage}"></div>
            `;
            document.querySelector('.pages-container').appendChild(newPage);
            editors[currentPage] = createQuillEditor(`editor-${currentPage}`);
            document.getElementById('totalPagesDisplay').textContent = currentPage;
            return currentPage;
        }

        function checkPageOverflow(quill, pageNum) {
            const editor = quill.root;
            const page = document.getElementById(`page-${pageNum}`);
            if (editor.scrollHeight > PAGE_HEIGHT_PX) {
                const range = quill.getSelection();
                const overflowIndex = quill.getIndex(quill.getLeaf(quill.getLength() - 1)[0]);
                const overflowDelta = quill.getContents(overflowIndex);
                quill.deleteText(overflowIndex, quill.getLength());

                let nextPage = pageNum + 1;
                if (!document.getElementById(`page-${nextPage}`)) {
                    createNewPage();
                }
                const nextEditor = editors[nextPage];
                nextEditor.setContents(overflowDelta);
                nextEditor.setSelection(0);
                checkPageOverflow(nextEditor, nextPage);
            }
        }

        function updateCurrentPageDisplay(pageNum) {
            document.getElementById('currentPageDisplay').textContent = pageNum;
        }

        // === STATS ===
        function updateStats() {
            let totalWords = 0, totalChars = 0, totalParagraphs = 0;
            Object.keys(editors).forEach(key => {
                const text = editors[key].getText();
                totalWords += text.trim().split(/\s+/).filter(w => w).length;
                totalChars += text.length;
                totalParagraphs += text.split('\n').filter(p => p.trim()).length;
            });
            document.getElementById('wordCount').textContent = totalWords;
            document.getElementById('charCount').textContent = totalChars;
            document.getElementById('totalPagesDisplay').textContent = Object.keys(editors).length;
        }

        // === DOCUMENT MANAGEMENT ===
        function checkForSharedDocument() {
            const urlParams = new URLSearchParams(window.location.search);
            const sharedToken = urlParams.get('shared_token');
            const docId = urlParams.get('doc_id');
            const permission = urlParams.get('permission');
            
            if (sharedToken && docId) {
                isSharedDocument = true;
                loadSharedDocument(sharedToken);
                
                if (permission === 'read') {
                    showReadonlyBanner();
                }
            }
        }

        async function loadSharedDocument(token) {
            try {
                showLoading('Cargando documento compartido...');
                
                const response = await fetch(`/share_bp/api/shared-document/${token}`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Error cargando documento compartido');
                }
                
                currentDocumentId = data.id;
                sharedDocumentInfo = data.share_info;
                
                document.getElementById('documentTitle').value = data.title;
                document.getElementById('documentTitle').disabled = true;
                
                if (data.delta && data.delta.ops) {
                    activeEditor.setContents(data.delta);
                }
                
                updateStatus('saved', 'Documento compartido cargado');
                
                if (data.share_info.readonly) {
                    disableEditorForReadonly();
                }
                
                hideLoading();
                showNotification(`Documento compartido por ${data.share_info.shared_by}`, 'info');
                
            } catch (error) {
                console.error('Error:', error);
                hideLoading();
                showNotification(error.message, 'error');
            }
        }

        function showReadonlyBanner() {
            document.getElementById('readonlyBanner').style.display = 'block';
        }

        function disableEditorForReadonly() {
            Object.values(editors).forEach(editor => editor.disable());
            document.getElementById('saveBtn').disabled = true;
            document.getElementById('shareBtn').disabled = true;
        }

        function isReadonly() {
            return isSharedDocument && sharedDocumentInfo && sharedDocumentInfo.readonly;
        }

        function loadUserEmail() {
            currentUserEmail = localStorage.getItem('userEmail') || prompt('Ingresa tu email:') || 'anonymous';
            if (currentUserEmail !== 'anonymous') {
                localStorage.setItem('userEmail', currentUserEmail);
            }
        }

        async function createNewDocument() {
            if (isSharedDocument) {
                showNotification('No puedes crear documentos en modo compartido', 'warning');
                return;
            }
            
            try {
                showLoading('Creando nuevo documento...');
                
                const response = await fetch('/api/document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Sin título',
                        owner_email: currentUserEmail
                    })
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error creando documento');
                }
                
                const data = await response.json();
                currentDocumentId = data.id;
                
                activeEditor.setContents([]);
                document.getElementById('documentTitle').value = data.title;
                document.getElementById('documentTitle').disabled = false;
                
                updateStatus('saved', 'Nuevo documento');
                
                await loadDocumentsList();
                hideLoading();
                
                showNotification('Nuevo documento creado', 'success');
                
            } catch (error) {
                console.error('Error:', error);
                hideLoading();
                showNotification(error.message, 'error');
            }
        }

        async function saveDocument(showFeedback = true, isAutosave = false) {
            if (!currentDocumentId || isSaving || isReadonly()) return;
            
            try {
                isSaving = true;
                
                if (showFeedback) {
                    updateStatus('saving', 'Guardando...');
                }
                
                // Combinar contenido de todas las páginas
                let fullDelta = { ops: [] };
                Object.keys(editors).sort((a, b) => parseInt(a) - parseInt(b)).forEach(key => {
                    const delta = editors[key].getContents();
                    fullDelta.ops = fullDelta.ops.concat(delta.ops);
                });
                
                const html = Object.keys(editors).map(k => editors[k].root.innerHTML).join('');
                const title = document.getElementById('documentTitle').value || 'Sin título';
                
                const response = await fetch(`/api/document/${currentDocumentId}/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        delta: fullDelta,
                        html: html,
                        title: title,
                        user_email: currentUserEmail,
                        is_autosave: isAutosave
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Error guardando');
                }
                
                const data = await response.json();
                
                updateStatus('saved', isAutosave ? 'Auto-guardado' : 'Guardado');
                
                if (showFeedback) {
                    showNotification(isAutosave ? 'Auto-guardado' : 'Documento guardado', 'success');
                }
                
                await loadDocumentsList();
                
            } catch (error) {
                console.error('Error:', error);
                updateStatus('error', 'Error al guardar');
                if (showFeedback) {
                    showNotification(error.message, 'error');
                }
            } finally {
                isSaving = false;
            }
        }

        async function loadDocument(docId) {
            try {
                showLoading('Cargando documento...');
                
                const response = await fetch(`/api/document/${docId}/load?user_email=${currentUserEmail}`);
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error cargando documento');
                }
                
                const data = await response.json();
                
                currentDocumentId = docId;
                document.getElementById('documentTitle').value = data.title;
                
                if (data.delta && data.delta.ops) {
                    activeEditor.setContents(data.delta);
                }
                
                updateStatus('saved', 'Documento cargado');
                hideLoading();
                
                updateActiveDocument(docId);
                
            } catch (error) {
                console.error('Error:', error);
                hideLoading();
                showNotification(error.message, 'error');
            }
        }

        async function deleteDocument(docId) {
            if (!confirm('¿Estás seguro de que quieres eliminar este documento?')) {
                return;
            }
            
            try {
                const response = await fetch(`/api/document/${docId}/delete?user_email=${currentUserEmail}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error eliminando documento');
                }
                
                showNotification('Documento eliminado', 'success');
                
                if (currentDocumentId === docId) {
                    await createNewDocument();
                }
                
                await loadDocumentsList();
                
            } catch (error) {
                console.error('Error:', error);
                showNotification(error.message, 'error');
            }
        }

        async function loadDocumentsList() {
            if (isSharedDocument) return;
            
            try {
                const response = await fetch(`/api/documents?owner_email=${currentUserEmail}&per_page=50`);
                
                if (!response.ok) {
                    throw new Error('Error cargando lista de documentos');
                }
                
                const data = await response.json();
                documents = data.documents || [];
                
                renderDocumentsList();
                
            } catch (error) {
                console.error('Error:', error);
                showNotification('Error cargando documentos', 'error');
            }
        }

        function renderDocumentsList() {
            const container = document.getElementById('documentsList');
            
            if (documents.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: #666;">No hay documentos</p>';
                return;
            }
            
            const html = documents.map(doc => `
                <div class="document-item ${doc.id === currentDocumentId ? 'active' : ''}" onclick="loadDocument(${doc.id})">
                    <h4>${escapeHtml(doc.title)}</h4>
                    <div class="document-meta">
                        <span>${formatDate(doc.updated_at)}</span>
                        <span>${formatBytes(doc.size_bytes || 0)}</span>
                    </div>
                    <div class="document-actions" onclick="event.stopPropagation()">
                        <button class="btn btn-danger btn-small" onclick="deleteDocument(${doc.id})">🗑️</button>
                        <button class="btn btn-secondary btn-small" onclick="loadDocument(${doc.id})">📄</button>
                    </div>
                </div>
            `).join('');
            
            container.innerHTML = html;
        }

        function updateActiveDocument(docId) {
            document.querySelectorAll('.document-item').forEach(item => {
                item.classList.remove('active');
            });
            
            const activeItem = document.querySelector(`.document-item[onclick="loadDocument(${docId})"]`);
            if (activeItem) {
                activeItem.classList.add('active');
            }
        }

        // === EXPORT FUNCTIONS ===
        function exportAsHTML() {
            let html = '';
            Object.keys(editors).forEach(k => {
                html += `<div style="page-break-after: always;">${editors[k].root.innerHTML}</div>`;
            });
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'document.html'; a.click();
            showNotification('Documento exportado como HTML', 'success');
        }

        function exportAsText() {
            let text = '';
            Object.keys(editors).forEach(k => text += editors[k].getText() + '\n\n');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'document.txt'; a.click();
            showNotification('Documento exportado como texto', 'success');
        }

        async function exportDocument(format) {
            if (!currentDocumentId) {
                showNotification('No hay documento para exportar', 'warning');
                return;
            }
            
            try {
                showLoading(`Exportando a ${format.toUpperCase()}...`);
                
                const response = await fetch(`/api/document/${currentDocumentId}/export/${format}?user_email=${currentUserEmail}`);
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error exportando documento');
                }
                
                const data = await response.json();
                
                const link = document.createElement('a');
                link.href = data.download_url;
                link.download = data.filename;
                link.click();
                
                hideLoading();
                showNotification(`Documento exportado a ${format.toUpperCase()}`, 'success');
                
            } catch (error) {
                console.error('Error:', error);
                hideLoading();
                showNotification(error.message, 'error');
            }
        }

        // === SHARE FUNCTIONS ===
        async function shareDocumentSubmit() {
            if (!currentDocumentId) {
                showNotification('No hay documento para compartir', 'warning');
                return;
            }
            
            try {
                const recipientEmail = document.getElementById('recipientEmail').value;
                const permissionLevel = document.getElementById('permissionLevel').value;
                const message = document.getElementById('shareMessage').value;
                const expiresInDays = parseInt(document.getElementById('expirationDays').value);
                
                const shareData = {
                    recipient_email: recipientEmail,
                    shared_by_email: currentUserEmail,
                    permission_level: permissionLevel,
                    message: message,
                    expires_in_days: expiresInDays
                };
                
                document.getElementById('shareLoading').style.display = 'inline-block';
                document.getElementById('shareSubmitBtn').disabled = true;
                
                const response = await fetch(`/api/document/${currentDocumentId}/share`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(shareData)
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error compartiendo documento');
                }
                
                const data = await response.json();
                
                showNotification(`Documento compartido con ${recipientEmail}`, 'success');
                hideShareModal();
                
                if (data.share_url) {
                    prompt('URL de compartir (copiado al portapapeles):', data.share_url);
                    navigator.clipboard.writeText(data.share_url).catch(() => {});
                }
                
            } catch (error) {
                console.error('Error:', error);
                showNotification(error.message, 'error');
            } finally {
                document.getElementById('shareLoading').style.display = 'none';
                document.getElementById('shareSubmitBtn').disabled = false;
            }
        }

        // === UPLOAD FUNCTIONS ===
        async function uploadDocument(file, customTitle = '') {
            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('owner_email', currentUserEmail);
                if (customTitle) {
                    formData.append('title', customTitle);
                }
                
                showUploadProgress('Subiendo archivo...');
                
                const response = await fetch('/upload_bp/api/document/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Error subiendo archivo');
                }
                
                const data = await response.json();
                
                await loadDocument(data.id);
                await loadDocumentsList();
                
                hideUploadModal();
                showNotification(`Documento "${data.original_filename}" subido exitosamente`, 'success');
                
            } catch (error) {
                console.error('Error:', error);
                hideUploadProgress();
                showNotification(error.message, 'error');
            }
        }

        function handleFileSelect(file) {
            if (!file) return;
            
            const customTitle = document.getElementById('customTitle').value.trim();
            uploadDocument(file, customTitle);
        }

        function setupDragAndDrop() {
            const uploadZone = document.getElementById('uploadZone');
            
            uploadZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                uploadZone.classList.add('drag-over');
            });
            
            uploadZone.addEventListener('dragleave', function() {
                uploadZone.classList.remove('drag-over');
            });
            
            uploadZone.addEventListener('drop', function(e) {
                e.preventDefault();
                uploadZone.classList.remove('drag-over');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    handleFileSelect(files[0]);
                }
            });
        }

        // === UI FUNCTIONS ===
        function toggleSidebar() {
            const sidebar = document.getElementById('documentsSidebar');
            const overlay = document.getElementById('sidebarOverlay');
            
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
            
            if (sidebar.classList.contains('open') && !isSharedDocument) {
                loadDocumentsList();
            }
        }

        function toggleExportMenu() {
            const dropdown = document.getElementById('exportDropdown');
            dropdown.classList.toggle('show');
        }

        function showShareModal() {
            if (!currentDocumentId) {
                showNotification('No hay documento para compartir', 'warning');
                return;
            }
            document.getElementById('shareModal').style.display = 'block';
        }

        function hideShareModal() {
            document.getElementById('shareModal').style.display = 'none';
            document.getElementById('shareForm').reset();
        }

        function showUploadModal() {
            document.getElementById('uploadModal').style.display = 'block';
        }

        function hideUploadModal() {
            document.getElementById('uploadModal').style.display = 'none';
            hideUploadProgress();
            document.getElementById('customTitle').value = '';
        }

        function showUploadProgress(text) {
            document.getElementById('uploadProgress').style.display = 'block';
            document.getElementById('uploadStatus').textContent = text;
        }

        function hideUploadProgress() {
            document.getElementById('uploadProgress').style.display = 'none';
        }

        function showLoading(text) {
            document.getElementById('loadingModal').style.display = 'block';
            document.getElementById('loadingText').textContent = text;
        }

        function hideLoading() {
            document.getElementById('loadingModal').style.display = 'none';
        }

        function showNotification(message, type = 'info') {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = `notification ${type}`;
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 4000);
        }

        function updateStatus(status, text) {
            const statusDot = document.getElementById('statusDot');
            const lastSaved = document.getElementById('lastSaved');
            
            statusDot.className = `status-dot status-${status}`;
            lastSaved.textContent = text;
            
            if (status === 'saved') {
                lastSaved.textContent = text + ' - ' + new Date().toLocaleTimeString();
            }
        }

        // === UTILITY FUNCTIONS ===
        function formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        function formatDate(dateString) {
            if (!dateString) return 'N/A';
            const date = new Date(dateString);
            return date.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // === EVENT LISTENERS ===
        document.getElementById('shareForm').addEventListener('submit', function(e) {
            e.preventDefault();
            shareDocumentSubmit();
        });

        document.addEventListener('click', function(event) {
            if (!event.target.closest('.dropdown')) {
                document.querySelectorAll('.dropdown-content').forEach(dropdown => {
                    dropdown.classList.remove('show');
                });
            }
        });

        window.addEventListener('click', function(event) {
            const modals = ['uploadModal', 'shareModal'];
            modals.forEach(modalId => {
                const modal = document.getElementById(modalId);
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });

        document.addEventListener('keydown', function(event) {
            if (event.ctrlKey || event.metaKey) {
                switch(event.key) {
                    case 's':
                        event.preventDefault();
                        saveDocument();
                        break;
                    case 'n':
                        event.preventDefault();
                        createNewDocument();
                        break;
                    case 'o':
                        event.preventDefault();
                        toggleSidebar();
                        break;
                }
            }
        });

        // === INIT ===
        document.addEventListener('DOMContentLoaded', () => {
            editors[1] = createQuillEditor('editor-1');
            activeEditor = editors[1];
            updateStats();
            checkForSharedDocument();
            setupDragAndDrop();
            loadUserEmail();
            
            if (!isSharedDocument) {
                createNewDocument();
            }
        });
