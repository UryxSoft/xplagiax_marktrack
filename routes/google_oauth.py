# google_oauth.py — Servicio Google OAuth 2.0
import os
import secrets
import requests
import urllib.parse
from flask import current_app, session
from eventlet import tpool


import _socket  # C extension — never monkey-patched by eventlet
_real_getaddrinfo = _socket.getaddrinfo


def _http_post(url, data, timeout):
    """
    Runs in a real OS thread via tpool.
    Temporarily replaces socket.getaddrinfo with the unpatched C implementation
    so DNS resolves correctly without touching the URL (TLS cert stays valid).
    """
    import socket
    socket.getaddrinfo = _real_getaddrinfo
    try:
        return requests.post(url, data=data, timeout=timeout)
    finally:
        socket.getaddrinfo = _socket.getaddrinfo  # restore (noop — same ref, but explicit)


def _http_get(url, headers, timeout):
    """Same approach as _http_post."""
    import socket
    socket.getaddrinfo = _real_getaddrinfo
    try:
        return requests.get(url, headers=headers, timeout=timeout)
    finally:
        socket.getaddrinfo = _socket.getaddrinfo


class GoogleOAuth:
    """Maneja el flujo de autenticación con Google OAuth 2.0."""

    def __init__(self):
        self.client_id = os.getenv(
            'GOOGLE_CLIENT_ID',
            "121671119534-92uo2m1vpju3m3msh74jcf389nqhif4r.apps.googleusercontent.com"
        )
        self.client_secret = os.getenv(
            'GOOGLE_CLIENT_SECRET',
            "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"
        )
        self.redirect_uri = os.getenv(
            'GOOGLE_REDIRECT_URI',
            "http://127.0.0.1:5000/auth_bp/google/callbackx"
        )

        # Endpoints de Google
        self.auth_url = "https://accounts.google.com/o/oauth2/v2/auth"
        self.token_url = "https://oauth2.googleapis.com/token"
        self.userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"

        # Scopes mínimos necesarios
        self.scopes = ["email", "profile"]

    def get_authorization_url(self):
        """Genera la URL de autorización y almacena el state CSRF en sesión."""
        state = secrets.token_urlsafe(32)
        session['oauth_state'] = state

        params = {
            'client_id': self.client_id,
            'redirect_uri': self.redirect_uri,
            'scope': ' '.join(self.scopes),
            'response_type': 'code',
            'state': state,
            'access_type': 'offline',
            'prompt': 'select_account'  # Permite elegir cuenta si hay múltiples
        }

        url = f"{self.auth_url}?{urllib.parse.urlencode(params)}"
        current_app.logger.debug("[GoogleOAuth] Authorization URL generada")
        return url

    def exchange_code_for_user_data(self, authorization_code, state):
        """
        Intercambia el authorization code por datos del usuario.
        Returns: (user_data dict, error_message str | None)
        """
        try:
            # ── Verificar state CSRF ──────────────────────────────────────────
            stored_state = session.get('oauth_state')
            if not stored_state or state != stored_state:
                current_app.logger.warning(
                    "[GoogleOAuth] State CSRF inválido — stored=%s received=%s",
                    bool(stored_state), state[:8] if state else None
                )
                return None, "Invalid OAuth state — possible CSRF attack"

            # Limpiar el state usado para que no pueda reutilizarse
            session.pop('oauth_state', None)
            current_app.logger.debug("[GoogleOAuth] State CSRF verificado correctamente")

            # ── Intercambiar código por access token ───────────────────────────
            token_data = {
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'code': authorization_code,
                'grant_type': 'authorization_code',
                'redirect_uri': self.redirect_uri
            }

            token_response = tpool.execute(_http_post, self.token_url, token_data, 10)

            if not token_response.ok:
                current_app.logger.error(
                    "[GoogleOAuth] Error obteniendo token: HTTP %s — %s",
                    token_response.status_code, token_response.text[:200]
                )
                return None, f"Error obtaining token: HTTP {token_response.status_code}"

            token_info = token_response.json()
            access_token = token_info.get('access_token')

            if not access_token:
                current_app.logger.error("[GoogleOAuth] No se recibió access_token en la respuesta")
                return None, "No access token received from Google"

            current_app.logger.debug("[GoogleOAuth] Access token obtenido")

            # ── Obtener información del usuario ────────────────────────────────
            headers = {'Authorization': f'Bearer {access_token}'}
            user_response = tpool.execute(_http_get, self.userinfo_url, headers, 10)

            if not user_response.ok:
                current_app.logger.error(
                    "[GoogleOAuth] Error obteniendo userinfo: HTTP %s",
                    user_response.status_code
                )
                return None, f"Error obtaining user info: HTTP {user_response.status_code}"

            user_data = user_response.json()

            if not user_data.get('email'):
                return None, "Could not obtain email from user info"

            current_app.logger.debug(
                "[GoogleOAuth] Datos de usuario obtenidos para: %s", user_data.get('email')
            )
            return user_data, None

        except requests.exceptions.Timeout:
            current_app.logger.error("[GoogleOAuth] Timeout de conexión")
            return None, "Connection timeout with Google"
        except requests.exceptions.RequestException as e:
            current_app.logger.error("[GoogleOAuth] Error de conexión: %s", e)
            return None, f"Connection error: {e}"
        except Exception:
            current_app.logger.exception("[GoogleOAuth] Error inesperado")
            return None, "Unexpected internal error"