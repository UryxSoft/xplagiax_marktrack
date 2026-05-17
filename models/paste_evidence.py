"""
paste_evidence.py — SQLAlchemy model for Internet Paste Detection
Table: pasted_internet_content

CREATE TABLE query (for manual creation if needed):

CREATE TABLE IF NOT EXISTS pasted_internet_content (
    id                  INTEGER       NOT NULL AUTO_INCREMENT,
    document_id         INTEGER       NOT NULL,
    user_id             INTEGER,
    student_id          INTEGER,
    paste_uuid          VARCHAR(36)   NOT NULL UNIQUE,
    pasted_text         TEXT          NOT NULL,
    source_url          VARCHAR(2048),
    source_domain       VARCHAR(255),
    clipboard_html      TEXT,
    internet_copy_score SMALLINT      NOT NULL DEFAULT 0,
    char_count          INTEGER       NOT NULL DEFAULT 0,
    is_active           TINYINT(1)    NOT NULL DEFAULT 1,
    is_removed          TINYINT(1)    NOT NULL DEFAULT 0,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_pic_document (document_id),
    INDEX idx_pic_student  (student_id),
    INDEX idx_pic_active   (is_active),
    FOREIGN KEY (document_id) REFERENCES marktrack_documents(id) ON DELETE CASCADE
);
"""

from settings.extensions import db
from datetime import datetime
from sqlalchemy import Index
import uuid


class PastedInternetContent(db.Model):
    """
    Stores evidence of text pasted from the internet inside the student Quill editor.
    is_active is flipped to False when the pasted text is no longer detected in the document.
    Records are never physically deleted — forensic audit trail.
    """
    __tablename__ = 'pasted_internet_content'

    id                  = db.Column(db.Integer, primary_key=True)
    document_id         = db.Column(db.Integer, db.ForeignKey('marktrack_documents.id', ondelete='CASCADE'),
                                    nullable=False)
    # For professor-owned documents where a student is an invitee
    user_id             = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    # For student_workspace_users (standalone student accounts)
    student_id          = db.Column(db.Integer, db.ForeignKey('student_workspace_users.id', ondelete='SET NULL'),
                                    nullable=True)
    paste_uuid          = db.Column(db.String(36), unique=True, nullable=False,
                                    default=lambda: str(uuid.uuid4()))
    pasted_text         = db.Column(db.Text, nullable=False)
    source_url          = db.Column(db.String(2048), nullable=True)
    source_domain       = db.Column(db.String(255), nullable=True)
    # Sanitized clipboard HTML (tags stripped, safe to store)
    clipboard_html      = db.Column(db.Text, nullable=True)
    # Heuristic internet-copy score: 0–100
    internet_copy_score = db.Column(db.SmallInteger, nullable=False, default=0)
    char_count          = db.Column(db.Integer, nullable=False, default=0)
    # Lifecycle flags — never delete, just deactivate
    is_active           = db.Column(db.Boolean, nullable=False, default=True)
    is_removed          = db.Column(db.Boolean, nullable=False, default=False)
    created_at          = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at          = db.Column(db.DateTime, nullable=False, default=datetime.utcnow,
                                    onupdate=datetime.utcnow)

    __table_args__ = (
        Index('idx_pic_document', 'document_id'),
        Index('idx_pic_student',  'student_id'),
        Index('idx_pic_active',   'is_active'),
    )

    def to_dict(self) -> dict:
        return {
            'id':                   self.id,
            'paste_uuid':           self.paste_uuid,
            'document_id':          self.document_id,
            'pasted_text':          self.pasted_text,
            'pasted_text_preview':  self.pasted_text[:200] if self.pasted_text else '',
            'source_url':           self.source_url,
            'source_domain':        self.source_domain,
            'internet_copy_score':  self.internet_copy_score,
            'char_count':           self.char_count,
            'is_active':            self.is_active,
            'is_removed':           self.is_removed,
            'created_at':           self.created_at.isoformat() if self.created_at else None,
        }

    @staticmethod
    def risk_level(score: int) -> str:
        if score >= 71:
            return 'high'
        if score >= 31:
            return 'medium'
        return 'low'
