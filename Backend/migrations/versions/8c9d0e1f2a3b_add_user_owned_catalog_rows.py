"""add user-owned catalog rows

Revision ID: 8c9d0e1f2a3b
Revises: 6b2f8f8d9c11
Create Date: 2026-05-01 13:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8c9d0e1f2a3b"
down_revision = "6b2f8f8d9c11"
branch_labels = None
depends_on = None


def _drop_named_unique(table_name: str, constraint_name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    uniques = {
        item["name"]
        for item in inspector.get_unique_constraints(table_name)
        if item.get("name")
    }
    if constraint_name in uniques:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="unique")


def upgrade() -> None:
    op.add_column(
        "ingredients",
        sa.Column("user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "foods",
        sa.Column("user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "plans",
        sa.Column("user_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "ingredient_sources",
        sa.Column("payload_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "ingredient_sources",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "ingredient_sources",
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default="false"),
    )

    _drop_named_unique("ingredients", "uq_ingredients_name")
    _drop_named_unique("foods", "uq_foods_name")
    _drop_named_unique("foods", "uq_meals_name")

    with op.batch_alter_table("ingredients") as batch_op:
        batch_op.create_foreign_key(
            "fk_ingredients_user_id_users",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "uq_ingredients_user_id_name",
            ["user_id", "name"],
        )
        batch_op.create_index("ix_ingredients_user_id", ["user_id"])

    with op.batch_alter_table("foods") as batch_op:
        batch_op.create_foreign_key(
            "fk_foods_user_id_users",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "uq_foods_user_id_name",
            ["user_id", "name"],
        )
        batch_op.create_index("ix_foods_user_id", ["user_id"])

    with op.batch_alter_table("plans") as batch_op:
        batch_op.create_foreign_key(
            "fk_plans_user_id_users",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_plans_user_id", ["user_id"])
        batch_op.create_index("ix_plans_user_updated", ["user_id", "updated_at"])

    op.create_table(
        "catalog_sync_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_sync_runs_source", "catalog_sync_runs", ["source"])


def downgrade() -> None:
    op.drop_index("ix_catalog_sync_runs_source", table_name="catalog_sync_runs")
    op.drop_table("catalog_sync_runs")

    with op.batch_alter_table("plans") as batch_op:
        batch_op.drop_index("ix_plans_user_updated")
        batch_op.drop_index("ix_plans_user_id")
        batch_op.drop_constraint("fk_plans_user_id_users", type_="foreignkey")
    with op.batch_alter_table("foods") as batch_op:
        batch_op.drop_index("ix_foods_user_id")
        batch_op.drop_constraint("uq_foods_user_id_name", type_="unique")
        batch_op.drop_constraint("fk_foods_user_id_users", type_="foreignkey")
        batch_op.create_unique_constraint("uq_foods_name", ["name"])
    with op.batch_alter_table("ingredients") as batch_op:
        batch_op.drop_index("ix_ingredients_user_id")
        batch_op.drop_constraint("uq_ingredients_user_id_name", type_="unique")
        batch_op.drop_constraint("fk_ingredients_user_id_users", type_="foreignkey")
        batch_op.create_unique_constraint("uq_ingredients_name", ["name"])

    op.drop_column("plans", "user_id")
    op.drop_column("foods", "user_id")
    op.drop_column("ingredients", "user_id")
    op.drop_column("ingredient_sources", "is_stale")
    op.drop_column("ingredient_sources", "last_synced_at")
    op.drop_column("ingredient_sources", "payload_hash")
