from app import app
from models.models import Folder, Document
import json

with app.app_context():
    folders = Folder.query.filter_by(is_deleted=False, is_archived=False).all()
    if folders:
        for f in folders:
            data = f.to_dict()
            real_count = Document.query.filter_by(folder_id=f.id, is_deleted=False).count()
            print(f"Folder ID: {f.id}, Name: {f.name}, doc_count (from to_dict): {data['doc_count']}, Real Count: {real_count}")
            assert data['doc_count'] == real_count
        print("Verification successful: doc_count matches real count for all folders.")
    else:
        print("No active folders found to verify.")
