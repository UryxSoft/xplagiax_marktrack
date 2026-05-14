/**
 * invite_registration.js
 * Registration and Signature handling for the Student View
 */

(function () {
    'use strict';

    function init() {
        const DOC_ID = window.DOCUMENT_ID;
        if (!DOC_ID) return;

        // Signature Canvas logic
        initSignature();
    }

    // ── Registration Logic ──────────────────────────────────────────
    window.handleRegistration = function(e) {
        if (e) e.preventDefault();

        var firstName = document.getElementById('firstName').value.trim();
        var lastName  = document.getElementById('lastName').value.trim();
        var password  = document.getElementById('regPassword') ? document.getElementById('regPassword').value : '';
        var password2 = document.getElementById('regPasswordConfirm') ? document.getElementById('regPasswordConfirm').value : '';
        var btn       = document.getElementById('registerBtn');

        if (!firstName || !lastName) return;

        // Client-side password validation
        if (password) {
            if (password.length < 8) {
                showFieldError('passwordError', 'At least 8 characters required');
                return;
            }
            if (!/[A-Z]/.test(password)) {
                showFieldError('passwordError', 'Need at least 1 uppercase letter');
                return;
            }
            if (!/\d/.test(password)) {
                showFieldError('passwordError', 'Need at least 1 number');
                return;
            }
            if (password !== password2) {
                showFieldError('passwordConfirmError', 'Passwords do not match');
                return;
            }
        }

        btn.disabled = true;
        btn.textContent = 'Creating account…';

        var payload = { first_name: firstName, last_name: lastName };
        if (password) {
            payload.password         = password;
            payload.password_confirm = password2;
        }

        fetch('/invite/' + window.TOKEN + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.csrfToken() },
            body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                document.getElementById('registrationOverlay').style.display = 'none';
                document.getElementById('editorArea').style.display = 'block';
                if (window.lucide) lucide.createIcons();
                if (window.PagesOffcanvas) window.PagesOffcanvas.refresh();
                window.location.reload();
            } else {
                btn.disabled = false;
                btn.textContent = 'Create Account & Continue';
                alert(data.error || 'Registration failed');
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = 'Create Account & Continue';
        });
    };

    // ── Password strength meter ─────────────────────────────────────
    window.updatePasswordStrength = function(val) {
        var wrap  = document.getElementById('pwStrengthWrap');
        var bar   = document.getElementById('pwStrengthBar');
        var label = document.getElementById('pwStrengthLabel');
        if (!wrap) return;
        if (!val) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';

        var score = 0;
        if (val.length >= 8)       score++;
        if (/[A-Z]/.test(val))     score++;
        if (/\d/.test(val))        score++;
        if (/[^A-Za-z0-9]/.test(val)) score++;
        if (val.length >= 12)      score++;

        var pct    = ['20%','40%','60%','80%','100%'][Math.max(0,score-1)];
        var colors = ['#ef4444','#f59e0b','#f59e0b','#22c55e','#22c55e'];
        var texts  = ['Too short','Weak','Fair','Strong','Very strong'];
        bar.style.width      = pct;
        bar.style.background = colors[Math.max(0,score-1)];
        label.textContent    = texts[Math.max(0,score-1)];
        label.style.color    = colors[Math.max(0,score-1)];

        // Clear any previous error
        showFieldError('passwordError', '');
    };

    window.checkPasswordMatch = function() {
        var p1 = document.getElementById('regPassword');
        var p2 = document.getElementById('regPasswordConfirm');
        if (!p1 || !p2) return;
        if (p2.value && p1.value !== p2.value) {
            showFieldError('passwordConfirmError', 'Passwords do not match');
        } else {
            showFieldError('passwordConfirmError', '');
        }
    };

    function showFieldError(id, msg) {
        var el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg || '';
        el.style.display = msg ? 'block' : 'none';
    }

    // ── Invite Login (returning student) ───────────────────────────
    window.handleInviteLogin = function(e) {
        if (e) e.preventDefault();
        var btn = document.getElementById('loginBtn');
        var err = document.getElementById('loginError');
        var password = document.getElementById('loginPassword').value;
        var email    = document.getElementById('loginEmail').value;
        if (!password) return;

        btn.disabled = true;
        btn.textContent = 'Signing in…';
        if (err) err.style.display = 'none';

        fetch('/student/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.csrfToken() },
            body: JSON.stringify({ email: email, password: password, token: window.TOKEN })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                window.location.href = '/invite/' + window.TOKEN;
            } else {
                if (err) { err.textContent = data.error || 'Login failed'; err.style.display = 'block'; }
                btn.disabled = false;
                btn.textContent = 'Sign In & Continue';
            }
        })
        .catch(function() {
            if (err) { err.textContent = 'Connection error. Try again.'; err.style.display = 'block'; }
            btn.disabled = false;
            btn.textContent = 'Sign In & Continue';
        });
    };


    // ── Signature Logic ─────────────────────────────────────────────
    function initSignature() {
        var canvas = document.getElementById('signatureCanvas');
        if (!canvas) return;

        var ctx = canvas.getContext('2d');
        var drawing = false;
        var lastPos = { x:0, y:0 };
        var color = '#000000';

        // Mouse events
        canvas.addEventListener('mousedown', function(e) {
            drawing = true;
            lastPos = getMousePos(canvas, e);
        });
        canvas.addEventListener('mousemove', function(e) {
            if (!drawing) return;
            var mousePos = getMousePos(canvas, e);
            renderCanvas(ctx, lastPos, mousePos, color);
            lastPos = mousePos;
        });
        canvas.addEventListener('mouseup', function() { drawing = false; });
        canvas.addEventListener('mouseleave', function() { drawing = false; });

        // Touch events
        canvas.addEventListener('touchstart', function(e) {
            e.preventDefault();
            drawing = true;
            lastPos = getTouchPos(canvas, e);
        });
        canvas.addEventListener('touchmove', function(e) {
            e.preventDefault();
            if (!drawing) return;
            var touchPos = getTouchPos(canvas, e);
            renderCanvas(ctx, lastPos, touchPos, color);
            lastPos = touchPos;
        });
        canvas.addEventListener('touchend', function() { drawing = false; });

        // Color selection
        document.querySelectorAll('.tool-btn[data-color]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.tool-btn[data-color]').forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                color = this.getAttribute('data-color');
            });
        });

        // Clear
        var clearBtn = document.getElementById('clearSignature');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                document.getElementById('submitWithSignature').disabled = true;
            });
        }

        // Integrity checkbox
        var integrityCb = document.getElementById('integrityCheckbox');
        if (integrityCb) {
            integrityCb.addEventListener('change', function() {
                document.getElementById('submitWithSignature').disabled = !this.checked;
            });
        }
    }

    function getMousePos(canvas, e) {
        var rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function getTouchPos(canvas, e) {
        var rect = canvas.getBoundingClientRect();
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }

    function renderCanvas(ctx, from, to, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.closePath();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
