"""Reviewed, all-personal legacy adoption. Caller owns the transaction."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from sqlalchemy import delete, select, text, update
from sqlmodel import Session, SQLModel
from Backend import models  # register all tables

VERSION = "all-personal-v1"
CHECKPOINT = "b42d8f0a315c"
CONTENT_TABLES = ("ingredients", "foods", "plans", "stored_food", "daily_log_entries")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def snapshot(session):
    result = {}
    for table in SQLModel.metadata.sorted_tables:
        if table.name in {"catalog_selections", "login_budgets"}:
            continue
        rows = session.connection().execute(select(table).order_by(*table.primary_key.columns)).mappings()
        result[table.name] = json.loads(canonical([dict(row) for row in rows]))
    return result


def reference_errors(data):
    """Validate real foreign keys plus the frontend's embedded plan references."""
    errors = []
    for table in SQLModel.metadata.sorted_tables:
        if table.name in {"catalog_selections", "login_budgets"}:
            continue
        for constraint in table.foreign_key_constraints:
            elements = list(constraint.elements)
            remote = elements[0].column.table.name
            allowed = {tuple(row[element.column.name] for element in elements) for row in data[remote]}
            for row in data[table.name]:
                key = tuple(row[element.parent.name] for element in elements)
                if all(value is not None for value in key) and key not in allowed:
                    errors.append(f"{table.name}: unresolved {constraint.name or remote} reference {key}")
    ingredients = {row["id"] for row in data["ingredients"]}
    foods = {row["id"] for row in data["foods"]}
    units = {row["id"]: row["ingredient_id"] for row in data["ingredient_units"]}
    recipe = defaultdict(set)
    for row in data["food_ingredients"]:
        recipe[row["food_id"]].add(row["ingredient_id"])
        if row["unit_id"] is not None and units.get(row["unit_id"]) != row["ingredient_id"]:
            errors.append(f"Recipe {row['food_id']}: unit belongs to another ingredient")
    def identity(value):
        if type(value) is int:
            return value
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return None
    def unit_ok(value, ingredient_id):
        return value is None or identity(value) == 0 or units.get(identity(value)) == ingredient_id
    def contains_reference(value):
        if isinstance(value, dict):
            return bool(set(value) & {"ingredientId", "foodId", "unitId", "overrides"}) or any(contains_reference(v) for v in value.values())
        return isinstance(value, list) and any(contains_reference(v) for v in value)
    for plan in data["plans"]:
        payload = plan["payload"]
        prefix = f"Plan {plan['id']}"
        if not isinstance(payload, dict) or not isinstance(payload.get("plan", []), list):
            errors.append(prefix + ": unrecognized payload structure")
            continue
        if contains_reference({key: value for key, value in payload.items() if key != "plan"}):
            errors.append(prefix + ": references outside recognized plan structure")
        for index, item in enumerate(payload.get("plan", [])):
            location = f"{prefix}, item {index}"
            if not isinstance(item, dict):
                errors.append(location + ": invalid item")
                continue
            kind = item.get("type")
            if kind == "ingredient":
                ingredient_id = identity(item.get("ingredientId"))
                if ingredient_id not in ingredients or not unit_ok(item.get("unitId"), ingredient_id):
                    errors.append(location + ": missing ingredient or mismatched unit")
                known = {"type", "ingredientId", "unitId", "amount", "portions"}
            elif kind == "food":
                food_id = identity(item.get("foodId"))
                overrides = item.get("overrides", {})
                if food_id not in foods or not isinstance(overrides, dict):
                    errors.append(location + ": missing food or invalid overrides")
                    continue
                for key, override in overrides.items():
                    ingredient_id = identity(key)
                    if (ingredient_id not in recipe[food_id] or not isinstance(override, dict)
                            or not unit_ok(override.get("unitId"), ingredient_id)):
                        errors.append(location + f": invalid override for ingredient {key}")
                    elif contains_reference({k:v for k,v in override.items() if k not in {"unitId", "quantity"}}):
                        errors.append(location + ": unrecognized override references")
                known = {"type", "foodId", "portions", "overrides"}
            else:
                errors.append(location + ": unknown item type")
                continue
            if contains_reference({key: value for key, value in item.items() if key not in known}):
                errors.append(location + ": unrecognized nested references")
    return sorted(errors)


def proposed_names(rows, max_length):
    reserved = {row["name"] for row in rows}
    seen, renames = set(), []
    for row in sorted(rows, key=lambda row: row["id"]):
        name = row["name"]
        if name not in seen:
            seen.add(name)
            continue
        counter = 0
        while True:
            suffix = f" [legacy #{row['id']}" + (f"-{counter}" if counter else "") + "]"
            replacement = name[:max_length-len(suffix)] + suffix
            if replacement not in reserved:
                break
            counter += 1
        reserved.add(replacement)
        renames.append({"id":row["id"], "old":name, "new":replacement})
    return renames


def build_report(session: Session, owner_id: str):
    data = snapshot(session)
    blockers = reference_errors(data)
    users = {row["id"]:row for row in data["users"]}
    owner = users.get(owner_id)
    admins = [row for row in users.values() if row["is_admin"]]
    if owner is None or owner["is_admin"] or not owner["is_active"]:
        blockers.append("Selected owner must be an existing active non-admin account.")
    if len(users) != 2 or len(admins) != 1 or not admins[0]["is_active"]:
        blockers.append("Adoption requires exactly two accounts: one active admin and the selected active non-admin. No accounts are deleted automatically.")
    preferences = defaultdict(set)
    for row in data["user_ingredient_preferences"]:
        preferences[row["ingredient_id"]].add(row["unit_id"])
    defaults = {row["ingredient_id"]:row["unit_id"] for row in data["ingredient_shopping_units"]}
    choices = []
    for ingredient in data["ingredients"]:
        ingredient_id = ingredient["id"]
        values = preferences[ingredient_id]
        if len(values) > 1:
            blockers.append(f"Ingredient {ingredient_id}: conflicting existing per-user shopping preferences.")
        unit_id = next(iter(values)) if len(values) == 1 else defaults.get(ingredient_id)
        if unit_id is not None:
            choices.append({"ingredient_id":ingredient_id, "unit_id":unit_id})
    report = {
        "version":VERSION, "owner_user_id":owner_id,
        "owner_email":owner["email"] if owner else None,
        "admin_user_id":admins[0]["id"] if len(admins) == 1 else None,
        "database_fingerprint":digest(data),
        "counts":{name:len(rows) for name,rows in data.items()},
        "assignments":{name:[row["id"] for row in data[name]] for name in CONTENT_TABLES},
        "previous_owners":{name:sorted({str(row.get("owner_user_id" if name in ("stored_food", "daily_log_entries") else "user_id")) for row in data[name]}) for name in CONTENT_TABLES},
        "legacy_identities":{name:sorted({row["user_id"] for row in data[name]}) for name in ("stored_food", "daily_log_entries")},
        "renames":{"ingredients":proposed_names(data["ingredients"],255), "foods":proposed_names(data["foods"],100)},
        "archive_sources":[{"id":row["id"], "ingredient_id":row["ingredient_id"], "source":row["source"], "source_id":row["source_id"]} for row in data["ingredient_sources"]],
        "shopping_preferences":choices,
        "shared_after_adoption":0,
        "blockers":sorted(blockers),
    }
    report["report_hash"] = digest(report)
    return report


def lock_writers(session):
    if session.bind.dialect.name == "postgresql":
        session.execute(text("SET LOCAL lock_timeout = '5s'"))
        names = sorted(table.name for table in SQLModel.metadata.sorted_tables if table.name not in {"catalog_selections", "login_budgets"})
        session.execute(text("LOCK TABLE " + ", ".join('"'+name+'"' for name in names) + " IN SHARE ROW EXCLUSIVE MODE"))


def apply_report(session: Session, owner_id: str, reviewed: dict):
    """One savepoint for all changes, including the completed adoption ledger."""
    if not isinstance(reviewed, dict):
        raise ValueError("Reviewed report must be a JSON object.")
    with session.begin_nested():
        lock_writers(session)
        ledger = session.get(models.OwnershipAdoption, VERSION)
        if ledger:
            if ledger.owner_user_id != owner_id or ledger.report_hash != reviewed.get("report_hash"):
                raise ValueError("Conflicting adoption rerun: owner or reviewed report differs.")
            return {"status":"already_applied", "version":VERSION, "owner_user_id":owner_id}
        report = build_report(session, owner_id)
        if canonical(reviewed) != canonical(report):
            raise ValueError("Report does not match current database state. Generate and review a fresh dry-run report.")
        if report["blockers"]:
            raise ValueError("Adoption blocked: " + "; ".join(report["blockers"]))
        data = snapshot(session)
        connection = session.connection()
        tables = SQLModel.metadata.tables
        connection.execute(tables["ownership_adoptions"].insert().values(version=VERSION, owner_user_id=owner_id,
            report_hash=report["report_hash"], mapping=report["assignments"], report=report))
        for table_name, renames in report["renames"].items():
            table = tables[table_name]
            for rename in renames:
                connection.execute(update(table).where(table.c.id == rename["id"]).values(name=rename["new"]))
        for name in CONTENT_TABLES:
            table = tables[name]
            owner_column = "owner_user_id" if name in ("stored_food", "daily_log_entries") else "user_id"
            values = {owner_column:owner_id}
            if name == "ingredients":
                values["is_shared"] = False
            if "updated_at" in table.c:
                values["updated_at"] = table.c.updated_at
            connection.execute(update(table).values(**values))
        for source in data["ingredient_sources"]:
            connection.execute(tables["ingredient_provenance_history"].insert().values(
                ingredient_id=source["ingredient_id"], source=source["source"], source_id=source["source_id"],
                adoption_version=VERSION, reason="Legacy data adopted as personal; external synchronization detached", details=source))
        connection.execute(delete(tables["ingredient_sources"]))
        connection.execute(delete(tables["user_ingredient_preferences"]))
        for preference in report["shopping_preferences"]:
            connection.execute(tables["user_ingredient_preferences"].insert().values(user_id=owner_id, **preference))
        after = snapshot(session)
        if reference_errors(after):
            raise ValueError("Post-adoption reference verification failed.")
        for name in CONTENT_TABLES:
            if [row["id"] for row in after[name]] != report["assignments"][name]:
                raise ValueError("Adoption changed entity IDs")
            owner_column = "owner_user_id" if name in ("stored_food", "daily_log_entries") else "user_id"
            if any(row[owner_column] != owner_id for row in after[name]):
                raise ValueError("Adoption ownership verification failed")
        mapping = {**report["assignments"], "_finalization_fingerprint":digest({name:rows for name,rows in after.items() if name != "ownership_adoptions"})}
        connection.execute(update(tables["ownership_adoptions"]).where(tables["ownership_adoptions"].c.version == VERSION).values(mapping=mapping))
        return {"status":"applied", "version":VERSION, "owner_user_id":owner_id, "report_hash":report["report_hash"]}
