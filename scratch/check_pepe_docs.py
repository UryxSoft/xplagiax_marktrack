from app import app
from models.models import Folder, Document
import json

with app.app_context():
    f = Folder.query.filter_by(name='PEPE').first()
    if f:
        print(f"PEPE Folder ID: {f.id}")
        docs = Document.query.filter_by(folder_id=f.id).all()
        print(f"Total documents found for PEPE: {len(docs)}")
        for d in docs:
            print(f" - ID: {d.id}, Title: {d.title}, Deleted: {d.is_deleted}, Archived: {d.is_archived}")
    else:
        print("PEPE folder not found")
