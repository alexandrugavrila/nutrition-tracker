"""Cutover fail-closed checks without Docker or database access."""

import importlib.util
import json
from pathlib import Path
from unittest.mock import Mock
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cutover', ROOT / 'scripts/prod/cutover.py')
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


def instance(tmp_path, stage):
    c = cutover.Cutover.__new__(cutover.Cutover)
    c.directory = tmp_path
    c.path = tmp_path / 'cutover.json'
    c.state = {'stage': stage}
    c.dc = Mock()
    c.app = Mock(side_effect=AssertionError('Unexpected DB mutation'))
    return c


@pytest.mark.parametrize('stage', ['prepared', 'expanded', 'review-required', 'finalized'])
def test_expansion_cannot_bypass_verified_backup(tmp_path, stage):
    c = instance(tmp_path, stage)
    with pytest.raises(ValueError, match='backed-up'):
        c.expand()
    c.dc.assert_not_called()


@pytest.mark.parametrize('service', ['backend', 'usda-sync', 'operator-oneoff'])
def test_running_writer_blocks_expansion(tmp_path, service):
    c = instance(tmp_path, 'backed-up')
    c.dc.return_value = json.dumps([{'State': 'running', 'Service': service}])
    with pytest.raises(ValueError, match='writers'):
        c.expand()


def test_compose_ndjson_detects_writer(tmp_path):
    c = instance(tmp_path, 'backed-up')
    c.dc.return_value = '\n'.join(
        json.dumps({'State': 'running', 'Service': s}) for s in ['db', 'backend']
    )
    with pytest.raises(ValueError, match='writers'):
        c.stopped()


def test_changed_review_report_cannot_apply(tmp_path):
    c = instance(tmp_path, 'review-required')
    c.dc.return_value = '[]'
    c.state['report_sha256'] = 'a' * 64
    (tmp_path / 'adoption.json').write_text('{}')
    with pytest.raises(ValueError, match='exact reviewed'):
        c.finalize('a' * 64)


def test_changed_backup_blocks_expansion(tmp_path):
    c = instance(tmp_path, 'backed-up')
    c.dc.return_value = '[]'
    c.state['backup_sha256'] = 'a' * 64
    (tmp_path / 'before.dump').write_bytes(b'corrupted')
    with pytest.raises(ValueError, match='checksum'):
        c.expand()


def test_mutable_image_rejected_before_docker(tmp_path):
    c = instance(tmp_path, None)
    with pytest.raises(ValueError, match='sha256'):
        c.prepare('backend:latest', 'frontend:latest')
    c.dc.assert_not_called()


@pytest.mark.parametrize(
    'url',
    [
        'postgresql://u:p@other:5432/nutrition',
        'postgresql://u:p@db:5432/other',
        'postgresql://u:p@db:5432/nutrition?options=unsafe',
    ],
)
def test_backup_and_backend_cannot_target_different_databases(tmp_path, url):
    c = instance(tmp_path, None)
    c.dc.return_value = json.dumps(
        {
            'services': {
                'db': {
                    'environment': {
                        'POSTGRES_USER': 'u',
                        'POSTGRES_PASSWORD': 'p',
                        'POSTGRES_DB': 'nutrition',
                    }
                },
                'backend': {'environment': {'DATABASE_URL': url}},
                'frontend': {},
            }
        }
    )
    with pytest.raises(ValueError, match='match the Compose db'):
        c.configuration_hash()


def test_failed_report_preserves_blockers_without_apply(tmp_path):
    import subprocess

    c = instance(tmp_path, 'expanded')
    c.dc.return_value = '[]'
    report = json.dumps({'blockers': ['Plan 123: unresolved reference']})
    c.app.side_effect = subprocess.CalledProcessError(1, ['report'], output=report)
    with pytest.raises(ValueError, match='unresolved reference'):
        c.report('owner@example.invalid')
    assert json.loads((tmp_path / 'adoption-blocked.json').read_text())['blockers']
    assert c.state['stage'] == 'expanded'
