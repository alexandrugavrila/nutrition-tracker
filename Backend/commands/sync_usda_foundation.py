"""Import a reviewed USDA Foundation JSON/ZIP artifact without changing personal records."""

from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
from urllib.parse import urlparse, urlunsplit
import zipfile
import httpx
from sqlmodel import Session
from Backend.db import engine
from Backend.services.foundation_sync import (
    _iter_foods,
    _hash_payload,
    _sync_units,
    sync_usda_foundation,
    record_failure,
)


def _strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key in Foundation artifact.')
            result[key] = value
        return result

    def constant(value):
        raise ValueError('Non-finite JSON number in Foundation artifact.')

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def _load_json_from_zip_bytes(raw, location=None):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith('.json')]
        if len(names) != 1:
            raise ValueError('Foundation ZIP must contain exactly one JSON document.')
        return _strict_json(archive.read(names[0]))


def _read_artifact(location):
    if urlparse(location).scheme in {'http', 'https'}:
        response = httpx.get(location, timeout=120.0, follow_redirects=True)
        response.raise_for_status()
        return response.content
    return Path(location).read_bytes()


def _decode_artifact(raw):
    return (
        _load_json_from_zip_bytes(raw) if zipfile.is_zipfile(io.BytesIO(raw)) else _strict_json(raw)
    )


def _load_payload(location):
    return _decode_artifact(_read_artifact(location))


def _artifact_uri(location):
    parsed = urlparse(location)
    if parsed.scheme in {'http', 'https'}:
        return urlunsplit((parsed.scheme, parsed.hostname or '', parsed.path, '', ''))[:2048]
    return Path(location).name[:2048]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--input',
        default=os.environ.get('USDA_FOUNDATION_FOODS_JSON'),
        help='Container-visible JSON/ZIP path or download URL.',
    )
    parser.add_argument(
        '--mark-stale',
        action='store_true',
        help='Mark absent previously synchronized Foundation entries stale; requires completeness evidence.',
    )
    parser.add_argument(
        '--complete-snapshot',
        action='store_true',
        help='Operator attests this is the full official Foundation snapshot, not a selection.',
    )
    parser.add_argument(
        '--expected-count', type=int, help='Reviewed record count of the complete snapshot.'
    )
    parser.add_argument(
        '--expected-sha256',
        help='Reviewed SHA256 of the input file bytes (ZIP bytes for ZIP input).',
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if not args.input:
        raise SystemExit(
            'Provide --input or USDA_FOUNDATION_FOODS_JSON pointing to FDC Foundation Foods JSON.'
        )
    if args.mark_stale and (
        not args.complete_snapshot or args.expected_count is None or args.expected_sha256 is None
    ):
        raise SystemExit(
            'Stale marking requires --complete-snapshot, --expected-count and --expected-sha256.'
        )
    artifact = None
    uri = _artifact_uri(args.input)
    try:
        raw = _read_artifact(args.input)
        artifact = hashlib.sha256(raw).hexdigest()
        payload = _decode_artifact(raw)
    except Exception as exc:
        # Never persist URLs with credentials or upstream exception messages.
        try:
            with Session(engine) as session:
                record_failure(
                    session, artifact_sha256=artifact, artifact_uri=uri, reason='artifact_read'
                )
        except Exception:
            raise SystemExit(
                'Foundation artifact could not be loaded; failure audit is unavailable.'
            ) from None
        raise SystemExit('Foundation artifact could not be loaded; catalog unchanged.') from None
    if engine.dialect.name != 'postgresql':
        raise SystemExit('Foundation maintenance requires PostgreSQL provider locking.')
    try:
        with Session(engine) as session:
            summary = sync_usda_foundation(
                session,
                payload,
                mark_stale=args.mark_stale,
                complete_snapshot=args.complete_snapshot,
                expected_count=args.expected_count,
                expected_sha256=args.expected_sha256,
                artifact_sha256=artifact,
                artifact_uri=uri,
            )
    except Exception:
        raise SystemExit(
            'Foundation synchronization failed; catalog transaction rolled back. Review the failure audit and input.'
        ) from None
    print(json.dumps({'artifact_sha256': artifact, **summary}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
