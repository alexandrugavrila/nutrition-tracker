"""Record explicit starter seeding per user and manifest version."""
from alembic import op
import sqlalchemy as sa

revision = "a31c7e9f204b"
down_revision = "91b4c6d8e2f0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("user_starter_seeds",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("manifest_version", sa.Integer(), primary_key=True),
        sa.Column("manifest_hash", sa.String(64), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))


def downgrade():
    op.drop_table("user_starter_seeds")
