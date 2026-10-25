"""Preserve unknown nutrients without rewriting numeric history."""

from alembic import op
import sqlalchemy as sa

revision = "e75a1c3d648f"
down_revision = "d64f0b2c537e"
branch_labels = depends_on = None
MACROS = ("calories", "protein", "carbohydrates", "fat", "fiber")
TABLES = ("nutrition", "stored_food", "daily_log_entries")


def fields(table):
    return [("per_portion_" if table == "stored_food" else "") + name for name in MACROS]


def upgrade():
    for table in TABLES:
        for column in fields(table):
            op.alter_column(table, column, nullable=True)


def downgrade():
    connection = op.get_bind()
    for table in TABLES:
        missing = " OR ".join(f"{column} IS NULL" for column in fields(table))
        if connection.execute(sa.text(f"SELECT 1 FROM {table} WHERE {missing} LIMIT 1")).first():
            raise RuntimeError(
                "Unknown nutrient values prevent downgrade; never replace them with zero."
            )
    for table in TABLES:
        for column in fields(table):
            op.alter_column(table, column, nullable=False)
