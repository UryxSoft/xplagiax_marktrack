from flask import Flask,Blueprint, request, jsonify, send_file, make_response,render_template, redirect, url_for
from flask_login import login_required, current_user
from settings.extensions import db, csrf

users_bp = Blueprint('users', __name__)

# Exempt preference API from CSRF (uses login_required for security)
csrf.exempt(users_bp)

@users_bp.route('/')
@users_bp.route('/home')
@login_required
def home():
    """Vista principal - Home (carpetas y documentos)"""
    return render_template('sections/home.html')

@users_bp.route('/analytics')
@login_required
def analytics():
    """Vista de Analytics - Integridad Académica"""
    return render_template('sections/analytics.html')

@users_bp.route('/almacenamiento')
@login_required
def almacenamiento():
    """Vista de Almacenamiento"""
    return render_template('sections/almacenamiento.html')

@users_bp.route('/workspace')
@login_required
def workspace():
    """Vista de Workspaces de Sesión"""
    return render_template('sections/workspace.html')


# ============================================================================
# USER PREFERENCES API
# ============================================================================

@users_bp.route('/api/user/preferences', methods=['GET'])
@login_required
def get_user_preferences():
    """Get user preferences including theme"""
    try:
        theme = getattr(current_user, 'theme_preference', None)
        return jsonify({
            'success': True,
            'preferences': {
                'theme': theme  # Returns None if no DB column, letting client use localStorage
            }
        })
    except Exception as e:
        # If column doesn't exist, return null so client uses localStorage
        return jsonify({
            'success': True,
            'preferences': {
                'theme': None
            }
        })


@users_bp.route('/api/user/preferences/theme', methods=['POST'])
@login_required
def save_theme_preference():
    """Save user's theme preference"""
    try:
        data = request.get_json()
        theme = data.get('theme', 'light')
        
        # Validate theme value
        if theme not in ['light', 'dark']:
            return jsonify({'success': False, 'error': 'Invalid theme value'}), 400
        
        # Try to save, but don't fail if column doesn't exist
        if hasattr(current_user, 'theme_preference'):
            current_user.theme_preference = theme
            db.session.commit()
        
        return jsonify({
            'success': True,
            'theme': theme
        })
    except Exception as e:
        # If column doesn't exist, just return success (saved in localStorage)
        return jsonify({
            'success': True,
            'theme': data.get('theme', 'light')
        })