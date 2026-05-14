from app import app
from flask import session
from flask_login import login_user
from models.models import User

def test_routes():
    with app.test_client() as client:
        # Create a test context
        with app.app_context():
            user = User.query.first()
            if not user:
                print("No users found in DB")
                return

            # Simulate login
            with client.session_transaction() as sess:
                sess['_user_id'] = str(user.id)
                sess['_fresh'] = True
            
            print("--- Testing /notifications/unread-count ---")
            res = client.get('/notifications/unread-count')
            print(f"Status: {res.status_code}")
            if res.status_code == 500:
                print(res.data.decode())
            
            print("\n--- Testing /notifications/dropdown ---")
            res = client.get('/notifications/dropdown')
            print(f"Status: {res.status_code}")
            if res.status_code == 500:
                print(res.data.decode())

if __name__ == "__main__":
    test_routes()
