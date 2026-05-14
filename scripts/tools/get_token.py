from app import app
from models.models import WorkspaceInvitation

def get_token():
    with app.app_context():
        inv = WorkspaceInvitation.query.filter_by(status='active').first()
        if inv:
            print(f"TOKEN: {inv.token}")
        else:
            inv = WorkspaceInvitation.query.first()
            if inv:
                print(f"TOKEN: {inv.token}")
            else:
                print("TOKEN: None")

if __name__ == "__main__":
    get_token()
