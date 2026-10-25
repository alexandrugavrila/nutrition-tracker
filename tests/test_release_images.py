"""Published-image rehearsal must never silently rebuild a release candidate."""

import argparse
from unittest.mock import Mock
import pytest
from testsupport.run_release_cutover import prepare_images, validate_images

BACKEND = 'example.invalid/backend@sha256:' + 'a' * 64
FRONTEND = 'example.invalid/frontend@sha256:' + 'b' * 64


def test_published_images_are_pulled_without_building():
    run = Mock()
    validate_images(argparse.ArgumentParser(), BACKEND, FRONTEND)
    prepare_images(run, BACKEND, FRONTEND, existing=True)
    assert [call.args[0] for call in run.call_args_list] == [
        ['docker', 'pull', BACKEND],
        ['docker', 'pull', FRONTEND],
    ]


@pytest.mark.parametrize(
    'backend,frontend',
    [
        (BACKEND, None),
        (None, FRONTEND),
        ('backend:latest', FRONTEND),
        (BACKEND, 'frontend@sha256:bad'),
    ],
)
def test_invalid_or_partial_image_pair_fails_before_io(backend, frontend):
    with pytest.raises(SystemExit):
        validate_images(argparse.ArgumentParser(), backend, frontend)


def test_default_still_builds_both_production_images():
    run = Mock()
    validate_images(argparse.ArgumentParser(), None, None)
    prepare_images(run, 'test:backend', 'test:frontend', existing=False)
    commands = [call.args[0] for call in run.call_args_list]
    assert len(commands) == 2 and all(command[:2] == ['docker', 'build'] for command in commands)
    assert commands[0][commands[0].index('--target') + 1] == 'prod'
