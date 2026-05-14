# microsoft_oauth.py — Servicio Microsoft OAuth 2.0
import os
import secrets
import requests
import urllib.parse
from flask import current_app, session


class MicrosoftOAuth:
    """Maneja el flujo de autenticación con Microsoft OAuth 2.0 (Azure AD)."""

    def __init__(self):
        self.client_id = os.getenv(
            'MICROSOFT_CLIENT_ID',
            "35f3700d-cfc1-42df-bde5-2f03206dbf82"
        )
        self.client_secret = os.getenv(
            'MICROSOFT_CLIENT_SECRET',
            "uv~8Q~nwt.OD0611lMKDiFW58GhNDeaIiueGnbln"
        )
        self.tenant_id = os.getenv('MICROSOFT_TENANT_ID', 'common')
        self.redirect_uri = os.getenv(
            'MICROSOFT_REDIRECT_URI',
            "http://localhost:5000/auth_bp/microsoft/callback"
        )

        # Endpoints de Microsoft
        self.auth_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/authorize"
        self.token_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        self.userinfo_url = "https://graph.microsoft.com/v1.0/me"

        # Scopes mínimos necesarios
        self.scopes = ["openid", "profile", "email", "User.Read"]

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
            'response_mode': 'query',
            'prompt': 'select_account'
        }

        url = f"{self.auth_url}?{urllib.parse.urlencode(params)}"
        current_app.logger.debug("[MicrosoftOAuth] Authorization URL generada")
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
                    "[MicrosoftOAuth] State CSRF inválido — stored=%s received=%s",
                    bool(stored_state), state[:8] if state else None
                )
                return None, "Invalid OAuth state — possible CSRF attack"

            session.pop('oauth_state', None)
            current_app.logger.debug("[MicrosoftOAuth] State CSRF verificado correctamente")

            # ── Intercambiar código por access token ───────────────────────────
            token_data = {
                'client_id': self.client_id,
                'client_secret': self.client_secret,
                'code': authorization_code,
                'grant_type': 'authorization_code',
                'redirect_uri': self.redirect_uri,
                'scope': ' '.join(self.scopes)
            }

            token_response = requests.post(self.token_url, data=token_data, timeout=10)

            if not token_response.ok:
                current_app.logger.error(
                    "[MicrosoftOAuth] Error obteniendo token: HTTP %s — %s",
                    token_response.status_code, token_response.text[:200]
                )
                return None, f"Error obtaining token: HTTP {token_response.status_code}"

            token_info = token_response.json()
            access_token = token_info.get('access_token')

            if not access_token:
                current_app.logger.error("[MicrosoftOAuth] No se recibió access_token en la respuesta")
                return None, "No access token received from Microsoft"

            current_app.logger.debug("[MicrosoftOAuth] Access token obtenido")

            # ── Obtener información del usuario vía Microsoft Graph ─────────────
            headers = {
                'Authorization': f'Bearer {access_token}',
                'Content-Type': 'application/json'
            }
            user_response = requests.get(self.userinfo_url, headers=headers, timeout=10)

            if not user_response.ok:
                current_app.logger.error(
                    "[MicrosoftOAuth] Error obteniendo userinfo: HTTP %s — %s",
                    user_response.status_code, user_response.text[:200]
                )
                return None, f"Error obtaining user info: HTTP {user_response.status_code}"

            user_data = user_response.json()

            # Microsoft usa 'mail' o 'userPrincipalName' como email
            email = user_data.get('mail') or user_data.get('userPrincipalName')
            if not email:
                return None, "Could not obtain email from Microsoft account"

            # Normalizar datos al mismo formato que Google
            normalized = {
                'id': user_data.get('id'),
                'email': email,
                'name': user_data.get('displayName', ''),
                'given_name': user_data.get('givenName', ''),
                'family_name': user_data.get('surname', ''),
                'picture': None,          # Requiere llamada separada a Graph API
                'verified_email': True,   # Microsoft siempre verifica emails
                'access_token': access_token  # Para obtener foto en el callback
            }

            current_app.logger.debug(
                "[MicrosoftOAuth] Datos normalizados para: %s", email
            )
            return normalized, None

        except requests.exceptions.Timeout:
            current_app.logger.error("[MicrosoftOAuth] Timeout de conexión")
            return None, "Connection timeout with Microsoft"
        except requests.exceptions.RequestException as e:
            current_app.logger.error("[MicrosoftOAuth] Error de conexión: %s", e)
            return None, f"Connection error: {e}"
        except Exception:
            current_app.logger.exception("[MicrosoftOAuth] Error inesperado")
            return None, "Unexpected internal error"

    def get_user_photo(self, access_token):
        """
        Descarga la foto de perfil del usuario desde Microsoft Graph.
        Returns: bytes del contenido de la imagen, o None si falla.
        """
        try:
            headers = {'Authorization': f'Bearer {access_token}'}
            response = requests.get(
                "https://graph.microsoft.com/v1.0/me/photo/$value",
                headers=headers,
                timeout=5
            )
            if response.ok:
                current_app.logger.debug("[MicrosoftOAuth] Foto de perfil descargada")
                return response.content
            current_app.logger.debug(
                "[MicrosoftOAuth] No hay foto disponible: HTTP %s", response.status_code
            )
            return None
        except Exception as e:
            current_app.logger.debug("[MicrosoftOAuth] Error descargando foto (no crítico): %s", e)
            return None