import pytest

from testsupport.database import validated_test_url


def test_application_database_is_not_a_test_target():
    assert validated_test_url({"DATABASE_URL": "postgresql://host/production"}) is None


@pytest.mark.parametrize("url,confirmation", [
    ("postgresql://localhost/production", "production"),
    ("postgresql://localhost/nutrition_test", ""),
    ("postgresql://localhost/nutrition_test", "other_test"),
    ("sqlite:///nutrition_test", "nutrition_test"),
    ("postgresql://localhost/nutrition_test?options=-csearch_path=public", "nutrition_test"),
])
def test_unsafe_targets_fail_before_connection(url, confirmation):
    with pytest.raises(RuntimeError, match="TEST_DATABASE_URL"):
        validated_test_url({"TEST_DATABASE_URL": url, "TEST_DATABASE_CONFIRM": confirmation})


def test_explicit_test_target_is_accepted():
    url = "postgresql://localhost/nutrition_test"
    assert validated_test_url({"TEST_DATABASE_URL": url,
                               "TEST_DATABASE_CONFIRM": "nutrition_test"}) == url
