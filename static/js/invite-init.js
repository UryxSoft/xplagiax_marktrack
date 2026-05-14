// ============================================
// invite-init.js
// Combined initialization scripts for invite editor
// ============================================

// --- Register Custom Image Blot ---
if (window.CustomImageBlot) {
    Quill.register(window.CustomImageBlot, true);
    console.log('[InviteEditor] CustomImageBlot registered successfully');
} else {
    console.error('[InviteEditor] CustomImageBlot not found!');
}

// --- Initialize Pagination System ---
// Pagination initialization is now handled entirely by marktrack-quill-bridge.js
// to prevent race conditions and duplicate initialization.


// Sidebar accordion logic is now handled in the inline script of invite.html
