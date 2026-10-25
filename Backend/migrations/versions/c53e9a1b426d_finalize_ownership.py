"""Finalize ownership after reviewed all-personal adoption.

Revision ID: c53e9a1b426d
Revises: b42d8f0a315c
"""
from alembic import op
import sqlalchemy as sa
import hashlib
import json

revision = "c53e9a1b426d"
down_revision = "b42d8f0a315c"
branch_labels = None
depends_on = None

CONTENT = {"ingredients":"user_id", "foods":"user_id", "plans":"user_id",
           "stored_food":"owner_user_id", "daily_log_entries":"owner_user_id"}


def upgrade():
    connection = op.get_bind()
    connection.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
    names = sorted(name for name in sa.inspect(connection).get_table_names() if name != "alembic_version")
    quoted = [connection.dialect.identifier_preparer.quote(name) for name in names]
    connection.execute(sa.text("LOCK TABLE " + ", ".join(quoted) + " IN SHARE ROW EXCLUSIVE MODE"))
    populated = any(connection.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")).scalar_one() for table in CONTENT)
    if populated:
        ledger = connection.execute(sa.text("SELECT owner_user_id, mapping, report FROM ownership_adoptions WHERE version = 'all-personal-v1'")).mappings().one_or_none()
        if ledger is None:
            raise RuntimeError("Stop at b42d8f0a315c and complete reviewed legacy adoption before finalizing ownership.")
        metadata = sa.MetaData()
        names = sorted(name for name in ledger['report']['counts'] if name != 'ownership_adoptions')
        metadata.reflect(connection, only=names)
        state = {}
        for name in names:
            table = metadata.tables[name]
            # Match the expansion models' Numeric(asdecimal=False) representation.
            for column in table.c:
                if isinstance(column.type, sa.Numeric):
                    column.type.asdecimal = False
            state[name] = [dict(row) for row in connection.execute(sa.select(table).order_by(*table.primary_key.columns)).mappings()]
        fingerprint = hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False).encode()).hexdigest()
        if fingerprint != ledger['mapping'].get('_finalization_fingerprint'):
            raise RuntimeError("Database changed after adoption; keep writers stopped and investigate before finalization.")
        for table, owner_column in CONTENT.items():
            rows = connection.execute(sa.text(f"SELECT id, {owner_column} AS owner FROM {table}")).mappings().all()
            if sorted(row['id'] for row in rows) != sorted(ledger['mapping'].get(table, [])) or any(row['owner'] != ledger['owner_user_id'] for row in rows):
                raise RuntimeError("Adoption contents or owners changed before finalization; keep writers stopped and investigate.")
        if connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM ingredients WHERE is_shared) OR EXISTS (SELECT 1 FROM ingredient_sources)")).scalar_one():
            raise RuntimeError("Adopted data must remain personal and detached from canonical source mappings.")
    op.create_check_constraint("ck_ingredients_personal_has_owner", "ingredients", "is_shared OR user_id IS NOT NULL")
    for table, column in CONTENT.items():
        if table != "ingredients":
            op.alter_column(table, column, existing_type=sa.String(36), nullable=False)


def downgrade():
    for table, column in CONTENT.items():
        if table != "ingredients":
            op.alter_column(table, column, existing_type=sa.String(36), nullable=True)
    op.drop_constraint("ck_ingredients_personal_has_owner", "ingredients", type_="check")
