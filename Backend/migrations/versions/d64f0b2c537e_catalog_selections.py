"""User catalog selections and shared login budgets."""

from alembic import op
import sqlalchemy as sa

revision = "d64f0b2c537e"
down_revision = "c53e9a1b426d"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "catalog_selections",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("ingredient_id", sa.Integer(), sa.ForeignKey("ingredients.id"), primary_key=True),
    )
    op.create_table(
        "login_budgets",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("window", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
    )
    # Existing recipes/plans keep their catalog dependencies available. Previously
    # global rows with no references are not silently added to every user's list.
    op.execute(
        "INSERT INTO catalog_selections(user_id, ingredient_id) SELECT DISTINCT f.user_id, i.id FROM foods f JOIN food_ingredients fi ON fi.food_id=f.id JOIN ingredients i ON i.id=fi.ingredient_id WHERE i.is_shared ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO catalog_selections(user_id, ingredient_id) SELECT owner_user_id, ingredient_id FROM stored_food WHERE ingredient_id IN (SELECT id FROM ingredients WHERE is_shared) UNION SELECT owner_user_id, ingredient_id FROM daily_log_entries WHERE ingredient_id IN (SELECT id FROM ingredients WHERE is_shared) ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO catalog_selections(user_id, ingredient_id) SELECT p.user_id, i.id FROM plans p CROSS JOIN LATERAL json_array_elements(CASE WHEN json_typeof(p.payload->'plan') = 'array' THEN p.payload->'plan' ELSE '[]'::json END) entry JOIN ingredients i ON entry->>'ingredientId' = i.id::text WHERE i.is_shared ON CONFLICT DO NOTHING"
    )
    op.execute(
        "INSERT INTO catalog_selections(user_id, ingredient_id) SELECT p.user_id, p.ingredient_id FROM user_ingredient_preferences p JOIN ingredients i ON i.id=p.ingredient_id WHERE i.is_shared ON CONFLICT DO NOTHING"
    )


def downgrade():
    op.drop_table("login_budgets")
    op.drop_table("catalog_selections")
