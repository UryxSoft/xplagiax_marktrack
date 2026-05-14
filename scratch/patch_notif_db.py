from app import app, db
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def patch_database():
    with app.app_context():
        try:
            # 1. Add student_id column to notifications
            logger.info("Adding student_id column to notifications table...")
            db.session.execute(text("ALTER TABLE notifications ADD COLUMN student_id INT NULL"))
            db.session.execute(text("ALTER TABLE notifications ADD CONSTRAINT fk_notif_student FOREIGN KEY (student_id) REFERENCES student_workspace_users(id) ON DELETE CASCADE"))
            db.session.commit()
            logger.info("Column student_id and constraint added.")
        except Exception as e:
            db.session.rollback()
            if "Duplicate column name" in str(e):
                logger.warning("Column student_id already exists.")
            else:
                logger.error(f"Error adding student_id: {e}")

        try:
            # 2. Add indices
            logger.info("Adding indices for student notifications...")
            db.session.execute(text("CREATE INDEX idx_notif_student_read ON notifications (student_id, `read`)"))
            db.session.commit()
            logger.info("Indices created.")
        except Exception as e:
            db.session.rollback()
            if "Duplicate key name" in str(e) or "already exists" in str(e):
                logger.warning("Index already exists.")
            else:
                logger.error(f"Error adding index: {e}")

if __name__ == "__main__":
    patch_database()
