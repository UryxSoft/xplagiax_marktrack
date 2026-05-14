from app import app
from models.models import WorkspaceInvitation

def check(token):
    with app.app_context():
        inv = WorkspaceInvitation.query.filter_by(token=token).first()
        if inv:
            print(f"FOUND: ID={inv.id}, Status={inv.status}")
        else:
            print("NOT FOUND")

if __name__ == "__main__":
    import sys
    token = sys.argv[1] if len(sys.argv) > 1 else '0pJlSeC5EIXGAiyTJTNCimMqwm2cxAwuG0K11nJdZ5o'
    check(token)
