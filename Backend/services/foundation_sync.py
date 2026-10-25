"""Transactional Foundation maintenance. Only verified provider objects are mutable here."""

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re

from fastapi import HTTPException
from sqlmodel import select
from Backend.models import (
    CatalogSyncRun,
    Ingredient,
    IngredientSource,
    IngredientUnit,
    Nutrition,
    IngredientShoppingUnit,
)
from Backend.services.catalog import NORMALIZATION_VERSION, lock_provider, normalize_verified


def _hash_payload(payload):
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    ).hexdigest()


def _iter_foods(payload):
    if isinstance(payload, list):
        foods = payload
    elif isinstance(payload, dict):
        keys = [
            key
            for key in ('FoundationFoods', 'Foundation Foods', 'foods', 'Foods')
            if key in payload
        ]
        if len(keys) != 1:
            raise ValueError('Expected exactly one Foundation food collection.')
        foods = payload[keys[0]]
    else:
        raise ValueError('Expected a Foundation food collection.')
    if (
        not isinstance(foods, list)
        or not foods
        or any(not isinstance(item, dict) for item in foods)
    ):
        raise ValueError('Foundation collection must be a nonempty list of records.')
    yield from foods


def validate_snapshot(
    payload,
    *,
    mark_stale=False,
    complete_snapshot=False,
    expected_count=None,
    expected_sha256=None,
    artifact_sha256=None,
):
    artifact = artifact_sha256 or _hash_payload(payload)
    if not re.fullmatch(r'[0-9a-fA-F]{64}', artifact):
        raise ValueError('Artifact SHA256 must contain 64 hexadecimal characters.')
    if expected_sha256 is not None and expected_sha256.lower() != artifact.lower():
        raise ValueError('Foundation artifact checksum does not match the reviewed checksum.')
    if mark_stale and (not complete_snapshot or expected_count is None or expected_sha256 is None):
        raise ValueError(
            'Stale marking requires --complete-snapshot, --expected-count and --expected-sha256.'
        )
    if mark_stale and (not isinstance(payload, dict) or 'FoundationFoods' not in payload):
        raise ValueError('Stale marking requires the complete FoundationFoods download envelope.')
    records = list(_iter_foods(payload))
    if expected_count is not None and (
        type(expected_count) is not int or expected_count <= 0 or len(records) != expected_count
    ):
        raise ValueError('Foundation record count does not match the reviewed count.')
    normalized = []
    seen = set()
    for raw in records:
        identifier = raw.get('fdcId')
        if type(identifier) is not int or not 0 < identifier < 2147483648:
            raise ValueError('Foundation record has an invalid fdcId.')
        if identifier in seen:
            # Even identical duplicates invalidate the completeness/count assertion.
            raise ValueError('Duplicate Foundation fdcId; resolve the input before importing.')
        seen.add(identifier)
        if raw.get('dataType') != 'Foundation':
            raise ValueError('Every bulk record must have dataType Foundation.')
        nutrients = raw.get('foodNutrients')
        if not isinstance(nutrients, list) or any(not isinstance(n, dict) for n in nutrients):
            raise ValueError('Foundation record has malformed foodNutrients.')
        for n in nutrients:
            if 'nutrient' in n and not isinstance(n['nutrient'], dict):
                raise ValueError('Foundation nutrient metadata is malformed.')
            value = n.get('value', n.get('amount'))
            if value is not None:
                try:
                    number = Decimal(str(value))
                    if not number.is_finite() or number < 0:
                        raise ValueError()
                except Exception as exc:
                    raise ValueError('Foundation nutrient amount is invalid.') from exc
        for key in ('foodPortions', 'foodMeasures'):
            portions = raw.get(key, [])
            if not isinstance(portions, list) or any(not isinstance(p, dict) for p in portions):
                raise ValueError('Foundation portions are malformed.')
            for portion in portions:
                try:
                    weight = Decimal(str(portion['gramWeight']))
                    if not weight.is_finite() or weight <= 0:
                        raise ValueError()
                except Exception as exc:
                    raise ValueError('Foundation portion conversion is invalid.') from exc
        try:
            item, digest = normalize_verified(identifier, raw)
        except HTTPException as exc:
            raise ValueError('Foundation record failed provider normalization validation.') from exc
        normalized.append((str(identifier), item, digest))
    return normalized, artifact.lower()


def _unit_key(name, grams):
    # Match database precision before comparing or storing conversions.
    return (
        str(name).strip().lower(),
        Decimal(str(grams)).quantize(Decimal('.0001'), rounding=ROUND_HALF_UP),
    )


def _provider_unit_key(data):
    key = _unit_key(data['name'], data['grams'])
    return ('g', Decimal(1)) if key == ('1 g', Decimal(1)) else key


def _sync_units(ingredient, units):
    existing = {_unit_key(u.name, u.grams): u for u in ingredient.units}
    resolved = []
    for data in units + [{'name': 'g', 'grams': 1}]:
        name = data['name']
        if _unit_key(name, data['grams']) == ('1 g', Decimal(1)):
            name = 'g'
        key = _unit_key(name, data['grams'])
        unit = existing.get(key)
        if unit is None:
            unit = IngredientUnit(name=name, grams=float(key[1]))
            ingredient.units.append(unit)
            existing[key] = unit
        # Never edit or delete a persisted unit, including legacy gram aliases.
        resolved.append((data, unit))
    return next((u for data, u in resolved if data.get('is_default')), existing[('g', Decimal(1))])


def _matches(ingredient, normalized):
    if ingredient.name != normalized['name'].strip() or ingredient.nutrition is None:
        return False
    for key, value in normalized['nutrition'].items():
        stored = getattr(ingredient.nutrition, key)
        if value is None or stored is None:
            if value != stored:
                return False
        elif _unit_key('value', value) != _unit_key('value', stored):
            return False
    keys = {_unit_key(u.name, u.grams) for u in ingredient.units}
    expected = {_provider_unit_key(u) for u in normalized['units']} | {('g', Decimal(1))}
    if not expected.issubset(keys):
        return False
    default = next(
        (u for u in normalized['units'] if u.get('is_default')), {'name': 'g', 'grams': 1}
    )
    current = ingredient.shopping_unit.unit if ingredient.shopping_unit else None
    return current is not None and _unit_key(current.name, current.grams) == _provider_unit_key(
        default
    )


def _upsert_nutrition(ingredient, values):
    if ingredient.nutrition is None:
        ingredient.nutrition = Nutrition(**values)
    else:
        for key, value in values.items():
            setattr(ingredient.nutrition, key, value)


def record_failure(
    session, *, artifact_sha256=None, artifact_uri=None, reason='validation', started_at=None
):
    if artifact_sha256 is not None and not re.fullmatch(r'[0-9a-fA-F]{64}', artifact_sha256):
        artifact_sha256 = None
    with session.begin():
        session.add(
            CatalogSyncRun(
                source='usda',
                status='failed',
                artifact_sha256=artifact_sha256,
                artifact_uri=artifact_uri,
                normalization_version=NORMALIZATION_VERSION,
                started_at=started_at or datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
                summary={'dataset': 'Foundation', 'reason': reason, 'catalog_changed': False},
            )
        )


def sync_usda_foundation(
    session,
    payload,
    *,
    mark_stale=False,
    complete_snapshot=False,
    expected_count=None,
    expected_sha256=None,
    artifact_sha256=None,
    artifact_uri=None,
):
    """Own a clean session's transaction. Failed catalog writes roll back; audit persists separately."""
    if session.in_transaction():
        raise ValueError('Foundation sync requires a clean dedicated session.')
    started = datetime.now(timezone.utc)
    artifact = artifact_sha256
    stage = 'validation'
    try:
        if artifact is None:
            artifact = _hash_payload(payload)
        records, artifact = validate_snapshot(
            payload,
            mark_stale=mark_stale,
            complete_snapshot=complete_snapshot,
            expected_count=expected_count,
            expected_sha256=expected_sha256,
            artifact_sha256=artifact,
        )
        stage = 'catalog_update'
        with session.begin():
            lock_provider(session, exclusive=True)
            now = datetime.now(timezone.utc)
            counts = dict(created=0, updated=0, unchanged=0, stale=0)
            run = CatalogSyncRun(
                source='usda',
                status='running',
                artifact_sha256=artifact,
                artifact_uri=artifact_uri,
                normalization_version=NORMALIZATION_VERSION,
                started_at=started,
            )
            session.add(run)
            session.flush()
            sources = {
                s.source_id: s
                for s in session.exec(
                    select(IngredientSource).where(IngredientSource.source == 'usda')
                ).all()
            }
            seen = set()
            for identifier, normalized, digest in records:
                seen.add(identifier)
                source = sources.get(identifier)
                if source:
                    ingredient = source.ingredient
                    if (
                        not ingredient.is_shared
                        or ingredient.user_id is not None
                        or source.verification_status != 'verified'
                    ):
                        raise ValueError(
                            'Provider mapping requires operator reconciliation; no personal record was changed.'
                        )
                    counts[
                        (
                            'unchanged'
                            if source.payload_hash == digest
                            and source.normalization_version == NORMALIZATION_VERSION
                            and not source.is_stale
                            and _matches(ingredient, normalized)
                            else 'updated'
                        )
                    ] += 1
                else:
                    ingredient = Ingredient(name=normalized['name'].strip(), is_shared=True)
                    source = IngredientSource(
                        source='usda', source_id=identifier, ingredient=ingredient
                    )
                    counts['created'] += 1
                ingredient.name = normalized['name'].strip()
                _upsert_nutrition(ingredient, normalized['nutrition'])
                default = _sync_units(ingredient, normalized['units'])
                if ingredient.shopping_unit is None:
                    ingredient.shopping_unit = IngredientShoppingUnit(unit=default)
                else:
                    ingredient.shopping_unit.unit = default
                source.payload_hash = digest
                source.artifact_sha256 = artifact
                source.normalization_version = NORMALIZATION_VERSION
                source.verification_status = 'verified'
                source.verified_at = source.last_synced_at = now
                source.import_run_id = run.id
                source.is_stale = False
                session.add(source)
                session.flush()
            if mark_stale:
                # Only previously bulk-managed Foundation entries, never Branded/API-only mappings.
                foundation_runs = set(
                    session.exec(
                        select(CatalogSyncRun.id).where(
                            CatalogSyncRun.source == 'usda', CatalogSyncRun.status == 'succeeded'
                        )
                    ).all()
                )
                foundation_runs = {
                    rid
                    for rid in foundation_runs
                    if session.get(CatalogSyncRun, rid).summary.get('dataset') == 'Foundation'
                }
                for identifier, source in sources.items():
                    if (
                        identifier not in seen
                        and source.import_run_id in foundation_runs
                        and source.verification_status == 'verified'
                        and source.ingredient.is_shared
                        and source.ingredient.user_id is None
                    ):
                        counts['stale'] += int(not source.is_stale)
                        source.is_stale = True
                        session.add(source)
            run.status = 'succeeded'
            run.completed_at = datetime.now(timezone.utc)
            run.summary = {
                'dataset': 'Foundation',
                'record_count': len(records),
                'complete_snapshot': bool(mark_stale and complete_snapshot),
                **counts,
            }
            session.add(run)
        return counts
    except Exception:
        session.rollback()
        record_failure(
            session,
            artifact_sha256=artifact,
            artifact_uri=artifact_uri,
            reason=stage,
            started_at=started,
        )
        raise
