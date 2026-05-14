from app import app
from models.models import EssaySubmissionMetrics, WorkspaceInvitation
import json

def check():
    with app.app_context():
        total = EssaySubmissionMetrics.query.count()
        print(f"TOTAL_ROWS: {total}")
        
        last = EssaySubmissionMetrics.query.order_by(EssaySubmissionMetrics.id.desc()).all()
        for row in last[:5]:
            print(f"ID: {row.id}, InvitationID: {row.invitation_id}, KS: {row.keystrokes}, Time: {row.total_time_seconds}, Meta: {row.session_metadata}")
            # print(f"Raw Logs: {len(row.raw_logs or [])}")

if __name__ == "__main__":
    check()
