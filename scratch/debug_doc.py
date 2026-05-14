from app import app
from models.models import Document
import json

with app.app_context():
    docs = Document.query.filter(Document.title.contains('InsideOut')).all()
    if docs:
        for d in docs:
            print(f"ID: {d.id}")
            print(f"Title: {d.title}")
            print(f"Content Type: {getattr(d, 'storage_type', 'database')}")
            print(f"Minio Path: {d.minio_path}")
            print(f"Is Deleted: {d.is_deleted}")
            print(f"Is Archived: {d.is_archived}")
            print("-" * 20)
    else:
        print("No documents found with 'InsideOut' in title")
