from app import app
from settings.extensions import db
from models.models import EssaySubmissionMetrics

def run():
    print("Test inserting dummy row")
    with app.app_context():
        try:
            new_row = EssaySubmissionMetrics(
                total_time_seconds=10,
                effective_time_seconds=5,
                keystrokes=1,
                wpm=0.0
            )
            db.session.add(new_row)
            db.session.commit()
            print("Success! Row ID:", new_row.id)
            count = EssaySubmissionMetrics.query.count()
            print("Total Rows:", count)
        except Exception as e:
            print("Error:", e)

run()
