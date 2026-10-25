from types import SimpleNamespace

import pytest

from Backend.routes import usda as usda_routes
from Backend.routes.usda import _trim_food_payload


@pytest.mark.parametrize(
    ("data_type", "serving_size", "serving_size_unit", "expected_calories", "expected_protein"),
    [
        ("Foundation", None, None, 0.89, 0.0109),
        ("Survey (FNDDS)", None, None, 0.89, 0.0109),
        ("SR Legacy", None, None, 0.89, 0.0109),
        ("Branded", 55, "g", 0.89, 0.0109),
    ],
)
def test_trim_food_payload_normalizes_supported_usda_foods_to_per_gram(
    data_type: str,
    serving_size: float | None,
    serving_size_unit: str | None,
    expected_calories: float,
    expected_protein: float,
) -> None:
    food = {
        "fdcId": 123,
        "description": "Banana sample",
        "dataType": data_type,
        "servingSize": serving_size,
        "servingSizeUnit": serving_size_unit,
        "foodNutrients": [
            {"nutrientName": "Energy", "value": 89},
            {"nutrientName": "Protein", "value": 1.09},
            {"nutrientName": "Total lipid (fat)", "value": 0.33},
            {"nutrientName": "Carbohydrate, by difference", "value": 22.84},
            {"nutrientName": "Fiber, total dietary", "value": 2.6},
        ],
    }

    payload = _trim_food_payload(food)

    assert payload["normalization"] == {
        "data_type": data_type,
        "source_basis": "per_100g",
        "normalized_basis": "per_g",
        "can_normalize": True,
        "reason": None,
        "serving_size": serving_size,
        "serving_size_unit": serving_size_unit,
        "household_serving_full_text": None,
    }
    assert payload["nutrition"] == pytest.approx(
        {
            "calories": expected_calories,
            "protein": expected_protein,
            "fat": 0.0033,
            "carbohydrates": 0.2284,
            "fiber": 0.026,
        }
    )


def test_trim_food_payload_includes_only_base_gram_unit_when_no_usda_measures_exist() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 111,
            "description": "Plain spice",
            "dataType": "Foundation",
            "foodNutrients": [],
        }
    )

    assert payload["units"] == [{"name": "g", "grams": 1.0, "is_default": True}]


def test_trim_food_payload_marks_branded_gram_serving_as_default_unit() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 222,
            "description": "Protein bar",
            "dataType": "Branded",
            "servingSize": 55,
            "servingSizeUnit": "g",
            "householdServingFullText": "1 bar",
            "foodNutrients": [],
        }
    )

    assert payload["units"] == [
        {"name": "g", "grams": 1.0, "is_default": False},
        {"name": "1 bar", "grams": 55.0, "is_default": True},
    ]


def test_trim_food_payload_includes_multiple_gram_backed_usda_units() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 333,
            "description": "Apple slices",
            "dataType": "Foundation",
            "foodNutrients": [],
            "foodPortions": [
                {
                    "amount": 1,
                    "measureUnit": {"name": "cup"},
                    "modifier": "sliced",
                    "gramWeight": 109,
                },
                {
                    "amount": 1,
                    "measureUnit": {"name": "RACC", "abbreviation": "RACC"},
                    "gramWeight": 140,
                },
                {
                    "portionDescription": "1 tbsp",
                    "gramWeight": 8.5,
                },
            ],
            "foodMeasures": [
                {
                    "amount": 2,
                    "measureUnitName": "piece",
                    "modifier": "rings",
                    "gramWeight": 35,
                }
            ],
        }
    )

    assert payload["units"] == [
        {"name": "g", "grams": 1.0, "is_default": True},
        {"name": "1 cup sliced", "grams": 109.0, "is_default": False},
        {"name": "1 tbsp", "grams": 8.5, "is_default": False},
        {"name": "2 piece rings", "grams": 35.0, "is_default": False},
    ]


def test_trim_food_payload_deduplicates_units_and_omits_entries_without_grams() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 444,
            "description": "Granola",
            "dataType": "Branded",
            "servingSize": 28,
            "servingSizeUnit": "g",
            "householdServingFullText": "1/4 cup",
            "foodNutrients": [],
            "foodPortions": [
                {"portionDescription": "1/4 cup", "gramWeight": 28},
                {"portionDescription": "1/4 CUP", "gramWeight": 28.0},
                {"portionDescription": "1 scoop", "gramWeight": None},
                {"portionDescription": "1 fl oz", "gramWeight": 0},
                {"portionDescription": "1 package"},
            ],
            "foodMeasures": [
                {"measureUnitName": "packet", "amount": 1, "gramWeight": 30},
                {"measureUnitName": "packet", "amount": 1, "gramWeight": 30.0},
            ],
        }
    )

    assert payload["units"] == [
        {"name": "g", "grams": 1.0, "is_default": False},
        {"name": "1/4 cup", "grams": 28.0, "is_default": True},
        {"name": "1 packet", "grams": 30.0, "is_default": False},
    ]


def test_trim_food_payload_marks_branded_liquids_as_not_normalizable() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 456,
            "description": "Orange juice sample",
            "dataType": "Branded",
            "servingSize": 240,
            "servingSizeUnit": "ml",
            "householdServingFullText": "8 fl oz",
            "foodNutrients": [
                {"nutrientName": "Energy", "value": 45},
                {"nutrientName": "Protein", "value": 0.8},
            ],
        }
    )

    assert payload["nutrition"] is None
    assert payload["units"] == [{"name": "g", "grams": 1.0, "is_default": True}]
    assert payload["normalization"] == {
        "data_type": "Branded",
        "source_basis": "per_100ml",
        "normalized_basis": None,
        "can_normalize": False,
        "reason": "USDA branded nutrients are standardized to 100 mL for this item, so they cannot be converted to per-gram values without density data.",
        "serving_size": 240.0,
        "serving_size_unit": "ml",
        "household_serving_full_text": "8 fl oz",
    }


def test_trim_food_payload_uses_usda_energy_variants_for_calories() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 555,
            "description": "Apple sample",
            "dataType": "Foundation",
            "foodNutrients": [
                {
                    "nutrientName": "Energy (Atwater General Factors)",
                    "value": 52,
                    "nutrient": {"id": 2047, "number": "2047", "unitName": "kcal"},
                },
                {
                    "nutrientName": "Protein",
                    "value": 0.26,
                    "nutrient": {"id": 1003, "number": "1003", "unitName": "g"},
                },
            ],
        }
    )

    assert payload["nutrition"] == pytest.approx(
        {
            "calories": 0.52,
            "protein": 0.0026,
            "fat": None,
            "carbohydrates": None,
            "fiber": None,
        }
    )


def test_trim_food_payload_ignores_non_kilocalorie_energy_variants() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 556,
            "description": "Energy in kilojoules only",
            "dataType": "Foundation",
            "foodNutrients": [
                {
                    "nutrientName": "Energy",
                    "value": 210,
                    "nutrient": {"id": 1062, "number": "1062", "unitName": "kJ"},
                }
            ],
        }
    )

    assert payload["nutrition"] == {
        "calories": None,
        "protein": None,
        "fat": None,
        "carbohydrates": None,
        "fiber": None,
    }


def test_trim_food_payload_uses_newer_foundation_macro_variants() -> None:
    payload = _trim_food_payload(
        {
            "fdcId": 557,
            "description": "Oats sample",
            "dataType": "Foundation",
            "foodNutrients": [
                {
                    "nutrientName": "Total fat (NLEA)",
                    "value": 5.89,
                    "nutrient": {"id": 1085, "number": "1085", "unitName": "g"},
                },
                {
                    "nutrientName": "Carbohydrate, by summation",
                    "value": 68.7,
                    "nutrient": {"id": 1050, "number": "1050", "unitName": "g"},
                },
                {
                    "nutrientName": "Total dietary fiber (AOAC 2011.25)",
                    "value": 10.4,
                    "nutrient": {"id": 2033, "number": "2033", "unitName": "g"},
                },
            ],
        }
    )

    assert payload["nutrition"] == pytest.approx(
        {
            "calories": None,
            "protein": None,
            "fat": 0.0589,
            "carbohydrates": 0.687,
            "fiber": 0.104,
        }
    )


class _MockUsdaResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _MockAsyncClient:
    def __init__(self, *args, **kwargs) -> None:
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, url: str, params):
        self.calls.append((url, params))
        return _MockUsdaResponse({"foods": []})


def test_search_foods_defaults_to_foundation_data_type(user_a_client, monkeypatch) -> None:
    mock_client = _MockAsyncClient()

    monkeypatch.setattr(usda_routes, "settings", SimpleNamespace(usda_api_key="test-key"))
    monkeypatch.setattr(usda_routes.httpx, "AsyncClient", lambda *args, **kwargs: mock_client)

    response = user_a_client.get("/api/usda/search", params={"query": "banana"})

    assert response.status_code == 200
    assert mock_client.calls == [
        (
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            {
                "query": "banana",
                "pageSize": 25,
                "dataType": ["Foundation"],
                "api_key": "test-key",
            },
        )
    ]


def test_search_foods_forwards_single_selected_data_type(user_a_client, monkeypatch) -> None:
    mock_client = _MockAsyncClient()

    monkeypatch.setattr(usda_routes, "settings", SimpleNamespace(usda_api_key="test-key"))
    monkeypatch.setattr(usda_routes.httpx, "AsyncClient", lambda *args, **kwargs: mock_client)

    response = user_a_client.get(
        "/api/usda/search",
        params=[("query", "banana"), ("data_types", "Branded")],
    )

    assert response.status_code == 200
    assert mock_client.calls == [
        (
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            {
                "query": "banana",
                "pageSize": 25,
                "dataType": ["Branded"],
                "api_key": "test-key",
            },
        )
    ]


def test_search_foods_forwards_multiple_selected_data_types(user_a_client, monkeypatch) -> None:
    mock_client = _MockAsyncClient()

    monkeypatch.setattr(usda_routes, "settings", SimpleNamespace(usda_api_key="test-key"))
    monkeypatch.setattr(usda_routes.httpx, "AsyncClient", lambda *args, **kwargs: mock_client)

    response = user_a_client.get(
        "/api/usda/search",
        params=[
            ("query", "banana"),
            ("data_types", "Foundation"),
            ("data_types", "Branded"),
            ("data_types", "Experimental"),
        ],
    )

    assert response.status_code == 200
    assert mock_client.calls == [
        (
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            {
                "query": "banana",
                "pageSize": 25,
                "dataType": ["Foundation", "Branded", "Experimental"],
                "api_key": "test-key",
            },
        )
    ]


def test_search_foods_rejects_unknown_data_types(user_a_client) -> None:
    response = user_a_client.get(
        "/api/usda/search",
        params=[("query", "banana"), ("data_types", "Totally Unknown")],
    )

    assert response.status_code == 422
