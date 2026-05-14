"""
scratch/add_yjs_state_column.py
One-off script to add the yjs_state binary column to the Documents table.
"""
import sys
import os

# Add root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app
from settings.extensions import db
from sqlalchemy import text, inspect

def add_column():
    with app.app_context():
        # Check if column exists
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('marktrack_documents')]
        
        if 'yjs_state' in columns:
            print("[DB] Column 'yjs_state' already exists in 'marktrack_documents'.")
            return

        print("[DB] Adding 'yjs_state' column to 'marktrack_documents'...")
        
        # Determine SQL dialect
        dialect = db.engine.dialect.name
        
        if dialect == 'mysql':
            sql = "ALTER TABLE marktrack_documents ADD COLUMN yjs_state LONGBLOB NULL"
        elif dialect == 'sqlite':
            sql = "ALTER TABLE marktrack_documents ADD COLUMN yjs_state BLOB NULL"
        else:
            # Generic binary
            sql = "ALTER TABLE marktrack_documents ADD COLUMN yjs_state VARBINARY(MAX) NULL"
            
        try:
            db.session.execute(text(sql))
            db.session.commit()
            print("[DB] Column added successfully.")
        except Exception as e:
            print(f"[DB] Error adding column: {e}")
            db.session.rollback()

if __name__ == "__main__":
    add_column()
