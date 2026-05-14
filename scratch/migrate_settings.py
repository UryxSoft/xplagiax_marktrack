import os
import sys
from sqlalchemy import text
from flask import Flask

# Add root to sys.path to import our app
sys.path.append(os.getcwd())

from settings.extensions import db
from app import app

with app.app_context():
    try:
        # Check if column exists first (MariaDB/MySQL approach)
        result = db.session.execute(text("SHOW COLUMNS FROM student_workspace_users LIKE 'settings_json'")).fetchone()
        if not result:
            print("Adding settings_json column to student_workspace_users table...")
            db.session.execute(text("ALTER TABLE student_workspace_users ADD COLUMN settings_json TEXT;"))
            db.session.commit()
            print("Successfully added column.")
        else:
            print("Column settings_json already exists.")
    except Exception as e:
        print(f"Error: {e}")
        db.session.rollback()
