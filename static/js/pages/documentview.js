/**
 * documentview.js
 * Logic for the Document View (Read-Only)
 */

(function () {
    'use strict';

    function init() {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
