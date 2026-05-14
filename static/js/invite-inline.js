        let saveTimeout = null;
        let isSaving = false;

        // Registration handler
        function handleRegistration(e) {
            e.preventDefault();
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            let valid = true;

            // Reset errors
            document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.form-group input').forEach(el => el.classList.remove('error'));

            if (!firstName) {
                document.getElementById('firstNameError').style.display = 'block';
                document.getElementById('firstName').classList.add('error');
                valid = false;
            }
            if (!lastName) {
                document.getElementById('lastNameError').style.display = 'block';
                document.getElementById('lastName').classList.add('error');
                valid = false;
            }
            if (!valid) return;

            const btn = document.getElementById('registerBtn');
            btn.disabled = true;
            btn.textContent = 'Registrando...';

            fetch(`/invite/${TOKEN}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ first_name: firstName, last_name: lastName })
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        // Hide modal, show editor
                        document.getElementById('registrationOverlay').style.display = 'none';
                        document.getElementById('editorArea').style.display = 'block';
                        // Initialize Quill after editor is visible
                        initQuillEditor();
                        loadDocument();
                        showToast('¡Registro exitoso! Puedes comenzar a escribir.', 'success');
                    } else {
                        showToast(data.error || 'Error al registrarse', 'error');
                        btn.disabled = false;
                        btn.textContent = 'Continuar al documento';
                    }
                })
                .catch(err => {
                    showToast('Error de conexión', 'error');
                    btn.disabled = false;
                    btn.textContent = 'Continuar al documento';
                });
        }

        // Quill editor reference
        let quillEditor = null;

        // Initialize Quill editor
        function initQuillEditor() {
            // If already initialized, skip
            if (quillEditor) {
                attachQuillAutoSave();
                return;
            }

            // Try pagination system first (provides centered page design)
            if (window.quillPagination) {
                quillEditor = window.quillPagination.quill;
            } else if (window.quill) {
                quillEditor = window.quill;
            }

            if (quillEditor) {
                window.quill = quillEditor;
                attachQuillAutoSave();
                console.log('[InviteEditor] Quill obtained from pagination system');
            } else {
                // Retry — pagination system may still be initializing
                setTimeout(initQuillEditor, 300);
            }
        }

        // Attach auto-save to Quill text-change event
        function attachQuillAutoSave() {
            if (!quillEditor) return;
            quillEditor.on('text-change', function (delta, oldDelta, source) {
                if (source === 'user') {
                    scheduleAutoSave();
                }
            });
        }

        // Load document content
        function loadDocument() {
            // If integration is active, let it handle loading to avoid race conditions
            if (window.inviteEditorIntegration || (window.InviteEditorIntegration && window.quillPagination)) {
                console.log('[Invite] Deferring load to InviteEditorIntegration');
                return;
            }

            fetch(`/invite/${TOKEN}/document`)
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.document) {
                        // Wait for Quill to be ready
                        const trySetContent = () => {
                            if (!quillEditor && window.quillPagination) {
                                quillEditor = window.quillPagination.quill || window.quill;
                            }
                            if (!quillEditor && window.quill) {
                                quillEditor = window.quill;
                            }

                            if (quillEditor) {
                                // USE PAGINATION IMPORT IF AVAILABLE
                                if (window.quillPagination && data.document.delta) {
                                    window.quillPagination.importContent({ delta: data.document.delta });
                                }
                                // Fallback for single page
                                else if (data.document.delta && data.document.delta.ops) {
                                    quillEditor.setContents(data.document.delta);
                                } else if (data.document.html) {
                                    quillEditor.root.innerHTML = data.document.html;
                                }

                                // Handle read-only state
                                if (data.is_closed) {
                                    quillEditor.disable();
                                    const saveStatus = document.getElementById('saveStatus');
                                    if (saveStatus) {
                                        saveStatus.innerHTML = '<i data-lucide="lock"></i><span>Read Only</span>';
                                        if (window.lucide) lucide.createIcons();
                                    }
                                } else {
                                    attachQuillAutoSave();
                                }
                            } else {
                                // Quill not ready yet, retry
                                setTimeout(trySetContent, 300);
                            }
                        };
                        trySetContent();
                    }
                })
                .catch(err => console.error('Error loading document:', err));
        }

        // Auto-save
        function scheduleAutoSave() {
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveDocument, 2000);

            // Show saving indicator
            const saveStatus = document.getElementById('saveStatus');
            if (saveStatus) {
                saveStatus.innerHTML = '<i data-lucide="loader" class="spin"></i><span>Unsaved</span>';
                if (window.lucide) lucide.createIcons();
            }
        }

        function saveDocument() {
            if (isSaving) return;
            if (!quillEditor) return;
            isSaving = true;

            const html = quillEditor.root.innerHTML;
            const delta = quillEditor.getContents();

            fetch(`/invite/${TOKEN}/document`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    html: html,
                    delta: delta
                })
            })
                .then(r => r.json())
                .then(data => {
                    isSaving = false;
                    const saveStatus = document.getElementById('saveStatus');
                    if (data.success) {
                        if (saveStatus) {
                            saveStatus.innerHTML = '<i data-lucide="check-circle"></i><span>Saved</span>';
                            if (window.lucide) lucide.createIcons();
                        }
                        // Update last saved time
                        const lastSaved = document.getElementById('lastSaved');
                        if (lastSaved) {
                            lastSaved.textContent = new Date().toLocaleTimeString();
                        }
                        // Dispatch event for AI Image Analysis
                        document.dispatchEvent(new CustomEvent('documentSaved', { detail: { timestamp: Date.now() } }));
                    } else {
                        if (saveStatus) {
                            saveStatus.innerHTML = '<i data-lucide="alert-circle"></i><span>Error</span>';
                            if (window.lucide) lucide.createIcons();
                        }
                    }
                })
                .catch(err => {
                    isSaving = false;
                    console.error('Save error:', err);
                });
        }

        // Toast
        function showToast(message, type) {
            const toast = document.getElementById('toast');
            toast.className = `toast toast-${type} show`;
            toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i> ${message}`;
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // User Dropdown
        function toggleUserDropdown() {
            const wrapper = document.getElementById('userDropdownWrapper');
            wrapper.classList.toggle('open');
        }

        // Close dropdown on outside click
        document.addEventListener('click', function (e) {
            const wrapper = document.getElementById('userDropdownWrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                wrapper.classList.remove('open');
            }
        });

        // Logout Modal
        function showLogoutModal() {
            const wrapper = document.getElementById('userDropdownWrapper');
            if (wrapper) wrapper.classList.remove('open');
            const overlay = document.getElementById('logoutModalOverlay');
            if (overlay) {
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        }

        function closeLogoutModal() {
            const overlay = document.getElementById('logoutModalOverlay');
            if (overlay) {
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function saveAndExit() {
            // Check for pagination system
            if (window.quillPagination) {
                const exported = window.quillPagination.exportContent();
                const html = exported.html;
                const delta = exported.delta;

                fetch(`/invite/${TOKEN}/document`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html: html, delta: delta })
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) {
                            showToast('Document saved successfully!', 'success');
                            setTimeout(() => { window.location.href = '/'; }, 800);
                        } else {
                            showToast('Error saving document', 'error');
                        }
                    })
                    .catch(() => {
                        showToast('Error saving document', 'error');
                    });
            }
            // Fallback for single page
            else if (quillEditor) {
                const html = quillEditor.root.innerHTML;
                const delta = quillEditor.getContents();
                fetch(`/invite/${TOKEN}/document`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html: html, delta: delta })
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) {
                            showToast('Document saved successfully!', 'success');
                            setTimeout(() => { window.location.href = '/'; }, 800);
                        } else {
                            showToast('Error saving document', 'error');
                        }
                    })
                    .catch(() => {
                        showToast('Error saving document', 'error');
                    });
            } else {
                window.location.href = '/';
            }
        }

        function exitWithoutSave() {
            window.location.href = '/';
        }

        // Settings Modal Handling
        document.addEventListener('DOMContentLoaded', () => {
            const settingsBtn = document.getElementById('settingsBtn');
            const settingsModal = document.getElementById('settingsModal');

            // Open Modal
            if (settingsBtn && settingsModal) {
                settingsBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    settingsModal.classList.add('active');
                });
            }

            // Close Modal (delegation)
            document.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('[data-modal]');
                if (closeBtn) {
                    const modalId = closeBtn.getAttribute('data-modal');
                    const modal = document.getElementById(modalId);
                    if (modal) {
                        modal.classList.remove('active');
                    }
                }

                // Close on overlay click
                if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal')) {
                    const modal = e.target.closest('.modal');
                    if (modal) modal.classList.remove('active');
                }
            });

            // Tabs in Settings
            const tabBtns = document.querySelectorAll('.settings-tabs .tab-btn');
            const panels = document.querySelectorAll('.settings-panel');

            tabBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Remove active from all
                    tabBtns.forEach(b => b.classList.remove('active'));
                    panels.forEach(p => p.style.display = 'none'); // or toggle class

                    // Add active to current
                    btn.classList.add('active');
                    const tabId = btn.getAttribute('data-tab');
                    const panel = document.getElementById(tabId);
                    if (panel) {
                        panel.style.display = 'block'; // or add class
                        panel.classList.add('active'); // ensure it has active class if needed
                    }
                });
            });

            // Theme Switching Logic in Settings
            const themeBtns = document.querySelectorAll('.theme-option');
            themeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    themeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const theme = btn.getAttribute('data-theme');

                    // Apply theme
                    if (theme === 'auto') {
                        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                        localStorage.removeItem('theme');
                    } else {
                        document.documentElement.setAttribute('data-theme', theme);
                        localStorage.setItem('theme', theme);
                    }
                });
            });

            // Initialize Settings Tabs (ensure first is active)
            if (tabBtns.length > 0 && panels.length > 0) {
                // Already set in HTML? Yes, class="active" and style="display:none"
                // Just ensure logic matches
            }
        });

        // Close logout modal on overlay click
        document.addEventListener('click', function (e) {
            const overlay = document.getElementById('logoutModalOverlay');
            if (e.target === overlay) {
                closeLogoutModal();
            }
        });

        // Init
        document.addEventListener('DOMContentLoaded', function () {
            const editorArea = document.getElementById('editorArea');

            if (editorArea && editorArea.style.display !== 'none') {
                // Editor is visible (already registered) — wait for Quill scripts to load
                // Use a small delay to ensure external scripts are loaded
                setTimeout(() => {
                    initQuillEditor();
                    // loadDocument(); // Handled by InviteEditorIntegration logic to prevent double loading
                }, 800);
            }

            // Focus first input in registration form
            const firstInput = document.getElementById('firstName');
            if (firstInput) setTimeout(() => firstInput.focus(), 400);

            // Save Draft button
            const saveDraftBtn = document.getElementById('saveDraftBtn');
            if (saveDraftBtn) {
                saveDraftBtn.addEventListener('click', function () {
                    // Use the globally exposed integration instance
                    if (window.inviteEditorIntegration) {
                        console.log('[InviteEditor] Manual save triggered');
                        window.inviteEditorIntegration.saveDocument(true);
                    } else {
                        console.error('[InviteEditor] Integration not ready');
                        alert('Editor not fully loaded yet. Please wait.');
                    }
                });
            }
        });
