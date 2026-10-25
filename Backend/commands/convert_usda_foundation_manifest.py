"""Convert USDA Foundation Foods into starter manifest USDA references."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from Backend.commands.sync_usda_foundation import _iter_foods, _load_payload
from Backend.services.usda_normalization import _trim_food_payload
from Backend.services.onboarding import STARTER_MANIFEST_PATH


def _usda_entries(payload: Any) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for raw_food in _iter_foods(payload):
        trimmed = _trim_food_payload(raw_food)
        source_id = trimmed.get("id")
        name = trimmed.get("name")
        if source_id is None or not name:
            continue
        entries.append(
            {
                "slug": f"usda-{source_id}",
                "name": str(name),
                "source": "usda",
                "source_id": str(source_id),
            }
        )
    return sorted(entries, key=lambda item: (item["name"].lower(), item["source_id"]))


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        default=os.environ.get("USDA_FOUNDATION_FOODS_JSON"),
        help="Path or URL for a USDA Foundation Foods JSON or ZIP download.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=STARTER_MANIFEST_PATH,
        help="Starter manifest to update.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional output path. Defaults to updating --manifest in place.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input:
        raise SystemExit(
            "Provide --input or USDA_FOUNDATION_FOODS_JSON pointing to FDC Foundation Foods JSON."
        )

    payload = _load_payload(args.input)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    entries = _usda_entries(payload)
    manifest.pop("catalog_ingredients", None)
    manifest["usda_ingredients"] = entries

    output_path = args.output or args.manifest
    _write_json(output_path, manifest)
    print(f"Wrote {len(entries)} USDA ingredient references to {output_path}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
