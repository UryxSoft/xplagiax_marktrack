from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from settings.extensions import db, csrf, limiter
from models.models import Folder, Document, FolderShare, User
from datetime import datetime

folder_bp = Blueprint('folders', __name__)
csrf.exempt(folder_bp)


# ─── LIST FOLDERS ───────────────────────────────────────────
@folder_bp.route('/api/folders', methods=['GET'])
@login_required
def list_folders():
    """Lista carpetas activas del usuario (no archivadas, no eliminadas)"""
    folders = Folder.query.filter_by(
        user_id=current_user.id,
        is_deleted=False,
        is_archived=False
    ).order_by(Folder.created_at.desc()).all()
    return jsonify({'folders': [f.to_dict() for f in folders]})


# ─── CREATE FOLDER ──────────────────────────────────────────
@folder_bp.route('/api/folder', methods=['POST'])
@login_required
def create_folder():
    """Crear nueva carpeta"""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    try:
        folder = Folder(
            name=name,
            color=data.get('color', '#6d28d9'),
            description=data.get('description', ''),
            path='',
            user_id=current_user.id,
            parent_id=data.get('parent_id')
        )
        db.session.add(folder)
        db.session.commit()
        return jsonify({'folder': folder.to_dict(), 'message': f'Carpeta "{name}" creada'}), 201
    except Exception as e:
        import traceback
        with open('debug_api.txt', 'w') as f:
            f.write(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


# ─── RENAME FOLDER ──────────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/rename', methods=['PUT'])
@login_required
def rename_folder(folder_id):
    """Renombrar carpeta"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada'}), 404

    data = request.get_json() or {}
    new_name = data.get('name', '').strip()
    if not new_name:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    old_name = folder.name
    folder.name = new_name
    db.session.commit()
    return jsonify({'folder': folder.to_dict(), 'message': f'Renombrada: "{old_name}" → "{new_name}"'})


# ─── CHANGE COLOR ───────────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/color', methods=['PUT'])
@login_required
def change_folder_color(folder_id):
    """Cambiar color de carpeta"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada'}), 404

    data = request.get_json() or {}
    color = data.get('color', '').strip()
    if not color:
        return jsonify({'error': 'Color es obligatorio'}), 400

    folder.color = color
    db.session.commit()
    return jsonify({'folder': folder.to_dict(), 'message': f'Color cambiado a {color}'})


# ─── ARCHIVE / UNARCHIVE ────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/archive', methods=['PUT'])
@login_required
def archive_folder(folder_id):
    """Archivar o desarchivar carpeta"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada'}), 404

    folder.is_archived = not folder.is_archived
    db.session.commit()
    action = 'archivada' if folder.is_archived else 'desarchivada'
    return jsonify({'folder': folder.to_dict(), 'message': f'"{folder.name}" {action}'})


# ─── SOFT DELETE ─────────────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/delete', methods=['DELETE'])
@login_required
def delete_folder(folder_id):
    """Enviar carpeta a la papelera (soft delete)"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada'}), 404

    folder.soft_delete()
    return jsonify({'message': f'"{folder.name}" enviada a la papelera'})


# ─── RESTORE FROM TRASH ─────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/restore', methods=['POST'])
@login_required
@limiter.limit("60/minute")
def restore_folder(folder_id):
    """Restaurar carpeta de la papelera o archivada"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada'}), 404

    if not folder.is_deleted and not folder.is_archived:
        return jsonify({'error': 'Carpeta no está en papelera ni archivada'}), 400

    folder.restore()
    return jsonify({'folder': folder.to_dict(), 'message': f'"{folder.name}" restaurada'})


# ─── PERMANENT DELETE ────────────────────────────────────────
@folder_bp.route('/api/folder/<int:folder_id>/delete-permanent', methods=['DELETE'])
@login_required
def delete_folder_permanent(folder_id):
    """Eliminar carpeta permanentemente"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id, is_deleted=True).first()
    if not folder:
        return jsonify({'error': 'Carpeta no encontrada en papelera'}), 404

    name = folder.name
    db.session.delete(folder)
    db.session.commit()
    return jsonify({'message': f'"{name}" eliminada permanentemente'})


@folder_bp.route('/api/folder/<int:folder_id>/share', methods=['POST'])
@login_required
def share_folder(folder_id):
    """Share a folder with another user by email"""
    folder = Folder.query.filter_by(id=folder_id, user_id=current_user.id, is_deleted=False).first()
    if not folder:
        return jsonify({'error': 'Folder not found or unauthorized'}), 404
        
    data = request.json or {}
    email = data.get('email')
    permission = data.get('permission', 'read')
    message = data.get('message', '')
    
    if not email:
        return jsonify({'error': 'Email is required'}), 400
        
    user_to_share_with = User.query.filter_by(email=email).first()
    if not user_to_share_with:
        return jsonify({'error': f'User with email {email} not found'}), 404
        
    if user_to_share_with.id == current_user.id:
        return jsonify({'error': 'Cannot share folder with yourself'}), 400

    existing_share = FolderShare.query.filter_by(
        folder_id=folder.id, 
        user_id=user_to_share_with.id, 
        is_active=True
    ).first()
    
    if existing_share:
        # Update existing share
        existing_share.permission_level = permission
        existing_share.share_message = message
        existing_share.shared_by_email = current_user.email
    else:
        # Create new share
        new_share = FolderShare(
            folder_id=folder.id,
            user_id=user_to_share_with.id,
            permission_level=permission,
            shared_by_email=current_user.email,
            share_message=message
        )
        db.session.add(new_share)
        
    try:
        db.session.commit()
        return jsonify({'message': f'Folder shared with {email} successfully!', 'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# ─── LIST TRASH (folders + documents) ────────────────────────
@folder_bp.route('/api/trash/all', methods=['GET'])
@login_required
def list_all_trash():
    """Listar todo en papelera: carpetas y documentos"""
    folders = Folder.query.filter_by(user_id=current_user.id, is_deleted=True).all()
    documents = Document.query.filter_by(owner_id=current_user.id, is_deleted=True).all()

    items = []
    for f in folders:
        d = f.to_dict()
        d['item_type'] = 'folder'
        items.append(d)
    for doc in documents:
        items.append({
            'id': doc.id,
            'name': doc.title,
            'item_type': 'document',
            'is_deleted': True,
            'deleted_at': doc.deleted_at.isoformat() if doc.deleted_at else None,
            'created_at': doc.created_at.isoformat() if doc.created_at else None,
        })

    return jsonify({'items': items})


# ─── BULK RESTORE ────────────────────────────────────────────
@folder_bp.route('/api/trash/restore-bulk', methods=['POST'])
@login_required
def restore_bulk():
    """Restaurar items en bulk"""
    data = request.get_json() or {}
    item_ids = data.get('items', [])  # [{id, item_type}]

    restored = 0
    for item in item_ids:
        if item.get('item_type') == 'folder':
            f = Folder.query.filter_by(id=item['id'], user_id=current_user.id, is_deleted=True).first()
            if f:
                f.restore()
                restored += 1
        elif item.get('item_type') == 'document':
            d = Document.query.filter_by(id=item['id'], owner_id=current_user.id, is_deleted=True).first()
            if d:
                d.restore()
                restored += 1

    return jsonify({'message': f'{restored} items restaurados', 'restored': restored})


# ─── BULK DELETE PERMANENT ───────────────────────────────────
@folder_bp.route('/api/trash/delete-bulk', methods=['POST'])
@login_required
def delete_bulk_permanent():
    """Eliminar items permanentemente en bulk"""
    data = request.get_json() or {}
    item_ids = data.get('items', [])  # [{id, item_type}]

    deleted = 0
    for item in item_ids:
        if item.get('item_type') == 'folder':
            f = Folder.query.filter_by(id=item['id'], user_id=current_user.id, is_deleted=True).first()
            if f:
                db.session.delete(f)
                deleted += 1
        elif item.get('item_type') == 'document':
            d = Document.query.filter_by(id=item['id'], owner_id=current_user.id, is_deleted=True).first()
            if d:
                db.session.delete(d)
                deleted += 1

    db.session.commit()
    return jsonify({'message': f'{deleted} items eliminados permanentemente', 'deleted': deleted})


# ─── LIST ARCHIVED ───────────────────────────────────────────
@folder_bp.route('/api/folders/archived', methods=['GET'])
@login_required
def list_archived():
    """Listar carpetas archivadas"""
    folders = Folder.query.filter_by(
        user_id=current_user.id,
        is_archived=True,
        is_deleted=False
    ).order_by(Folder.created_at.desc()).all()
    
    documents = Document.query.filter_by(
        owner_id=current_user.id,
        is_archived=True,
        is_deleted=False
    ).order_by(Document.created_at.desc()).all()

    items = []
    for f in folders:
        d = f.to_dict()
        d['item_type'] = 'folder'
        items.append(d)
    for doc in documents:
        items.append({
            'id': doc.id,
            'name': doc.title,
            'item_type': 'document',
            'is_archived': True,
            'created_at': doc.created_at.isoformat() if doc.created_at else None,
            'updated_at': doc.updated_at.isoformat() if doc.updated_at else None,
        })

    return jsonify({'items': items, 'folders': [f.to_dict() for f in folders]})
