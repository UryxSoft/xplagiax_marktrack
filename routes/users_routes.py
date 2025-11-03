from flask import Flask,Blueprint, request, jsonify, send_file, make_response,render_template

users_bp = Blueprint('users', __name__)

@users_bp.route('/')
def index():
    """Route principal que renderiza el template index.html"""
    return render_template('home.html')

@users_bp.route('/home')
def home():
    """Route principal que renderiza el template index.html"""
    return render_template('home.html')

@users_bp.route('/editor')
def idtor():
    """Route principal que renderiza el template index.html"""
    return render_template('editor2.html')