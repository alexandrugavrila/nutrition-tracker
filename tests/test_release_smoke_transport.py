"""Browser smoke must not silently weaken the selected transport contract."""
from pathlib import Path
import shutil
import subprocess


def test_smoke_transport_contract():
    root = Path(__file__).resolve().parents[1]
    node = shutil.which('node')
    assert node, 'Node is required to validate the release browser contract'
    subprocess.run([node, '-e', """
const assert = require('node:assert/strict');
const { readSettings } = require('./testsupport/release_https_smoke.cjs');
assert.equal(readSettings({RELEASE_HTTPS_ORIGIN:'https://localhost:1234'}).transport, 'https');
assert.equal(readSettings({RELEASE_HTTPS_ORIGIN:'http://localhost:1234', RELEASE_TRANSPORT:'http'}).transport, 'http');
for (const env of [
  {},
  {RELEASE_HTTPS_ORIGIN:'http://localhost'},
  {RELEASE_HTTPS_ORIGIN:'https://localhost', RELEASE_TRANSPORT:'http'},
  {RELEASE_HTTPS_ORIGIN:'http://localhost', RELEASE_TRANSPORT:'http', RELEASE_LOCAL_CERT:'1'},
  {RELEASE_HTTPS_ORIGIN:'https://nutrition.internal', RELEASE_LOCAL_CERT:'1'},
  {RELEASE_HTTPS_ORIGIN:'https://user:secret@localhost'},
  {RELEASE_HTTPS_ORIGIN:'https://localhost/path'},
  {RELEASE_HTTPS_ORIGIN:'https://localhost', RELEASE_TRANSPORT:'anything'},
]) assert.throws(() => readSettings(env));
assert.equal(readSettings({RELEASE_HTTPS_ORIGIN:'https://localhost', RELEASE_LOCAL_CERT:'1'}).local, true);
"""], cwd=root, check=True, timeout=20)
