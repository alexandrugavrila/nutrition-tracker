"""Test-only application wrapper pointing USDA HTTP at a disposable local fixture."""

import os
from urllib.parse import urlsplit
from testsupport.database import validated_test_url

if os.environ.get('ENVIRONMENT') != 'test' or validated_test_url(os.environ) is None:
    raise RuntimeError('E2E application requires an explicitly confirmed disposable database')
from Backend.backend import app
from Backend.routes import usda

url = os.environ['E2E_USDA_BASE_URL']
if urlsplit(url).hostname != '127.0.0.1':
    raise RuntimeError('E2E provider must be loopback')
usda._BASE_URL = url
