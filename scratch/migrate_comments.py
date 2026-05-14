import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

try:
    from app import app
    from settings.extensions import db
    from sqlalchemy import text

    with app.app_context():
        try:
            # Check if column exists first (optional but safer)
            # For simplicity, we just try to add it and catch the error if it exists.
            db.session.execute(text("ALTER TABLE document_comments ADD COLUMN page_index INTEGER"))
            db.session.commit()
            print("SUCCESS: Column 'page_index' added to 'document_comments' table.")
        except Exception as e:
            if "Duplicate column name" in str(e) or "already exists" in str(e).lower():
                print("INFO: Column 'page_index' already exists.")
            else:
                print(f"ERROR: {e}")
except Exception as e:
    print(f"CRITICAL ERROR: Could not initialize app context: {e}")
