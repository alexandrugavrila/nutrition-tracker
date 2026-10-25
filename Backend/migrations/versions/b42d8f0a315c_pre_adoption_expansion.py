"""Pre-adoption checkpoint: expand ownership, trust and preference storage.

No row is assigned, published, verified or deleted by this migration.
Stop here for the explicit adoption operation before future final constraints.
"""
from alembic import op
import sqlalchemy as sa

revision = "b42d8f0a315c"
down_revision = "a31c7e9f204b"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ingredients", sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="false"))
    op.create_check_constraint("ck_ingredients_shared_has_no_owner", "ingredients", "NOT is_shared OR user_id IS NULL")
    for table in ("stored_food", "daily_log_entries"):
        op.add_column(table, sa.Column("owner_user_id", sa.String(36), nullable=True))
        op.create_foreign_key(f"fk_{table}_owner_user_id_users", table, "users", ["owner_user_id"], ["id"])
        op.create_index(f"ix_{table}_owner_user_id", table, ["owner_user_id"])
    for name, type_ in (("artifact_sha256", sa.String(64)), ("artifact_uri", sa.String(2048)), ("normalization_version", sa.String(50))):
        op.add_column("catalog_sync_runs", sa.Column(name, type_, nullable=True))
    op.add_column("ingredient_sources", sa.Column("verification_status", sa.String(20), nullable=False, server_default="unverified"))
    for name, type_ in (("verified_at", sa.DateTime(timezone=True)), ("artifact_sha256", sa.String(64)), ("normalization_version", sa.String(50)), ("import_run_id", sa.Integer())):
        op.add_column("ingredient_sources", sa.Column(name, type_, nullable=True))
    op.create_foreign_key("fk_ingredient_sources_import_run", "ingredient_sources", "catalog_sync_runs", ["import_run_id"], ["id"])
    op.create_check_constraint("ck_source_verification_status", "ingredient_sources", "verification_status IN ('unverified', 'verified', 'rejected')")
    op.create_check_constraint("ck_verified_source_evidence", "ingredient_sources", "verification_status != 'verified' OR (verified_at IS NOT NULL AND artifact_sha256 IS NOT NULL AND normalization_version IS NOT NULL)")
    op.create_table("user_ingredient_preferences",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("ingredient_id", sa.Integer(), sa.ForeignKey("ingredients.id"), primary_key=True),
        sa.Column("unit_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["ingredient_id", "unit_id"], ["ingredient_units.ingredient_id", "ingredient_units.id"], name="fk_user_preference_unit_matches_ingredient"))
    op.create_table("ownership_adoptions",
        sa.Column("version", sa.String(50), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("report_hash", sa.String(64), nullable=False),
        sa.Column("mapping", sa.JSON(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_table("ingredient_provenance_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ingredient_id", sa.Integer(), sa.ForeignKey("ingredients.id"), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("source_id", sa.String(100), nullable=False),
        sa.Column("adoption_version", sa.String(50), sa.ForeignKey("ownership_adoptions.version"), nullable=True),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_ingredient_provenance_history_ingredient_id", "ingredient_provenance_history", ["ingredient_id"])


def downgrade():
    # This loses expansion metadata. Use a matched backup/image restore for cutover recovery.
    op.drop_table("ingredient_provenance_history")
    op.drop_table("ownership_adoptions")
    op.drop_table("user_ingredient_preferences")
    op.drop_constraint("ck_verified_source_evidence", "ingredient_sources", type_="check")
    op.drop_constraint("ck_source_verification_status", "ingredient_sources", type_="check")
    op.drop_constraint("fk_ingredient_sources_import_run", "ingredient_sources", type_="foreignkey")
    for name in ("verification_status", "verified_at", "artifact_sha256", "normalization_version", "import_run_id"):
        op.drop_column("ingredient_sources", name)
    for name in ("artifact_sha256", "artifact_uri", "normalization_version"):
        op.drop_column("catalog_sync_runs", name)
    for table in ("stored_food", "daily_log_entries"):
        op.drop_index(f"ix_{table}_owner_user_id", table_name=table)
        op.drop_constraint(f"fk_{table}_owner_user_id_users", table, type_="foreignkey")
        op.drop_column(table, "owner_user_id")
    op.drop_constraint("ck_ingredients_shared_has_no_owner", "ingredients", type_="check")
    op.drop_column("ingredients", "is_shared")
