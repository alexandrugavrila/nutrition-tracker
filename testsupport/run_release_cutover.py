"""Disposable production-image cutover, backup restore and failure rehearsal."""

import importlib.util
import argparse
import re
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import shutil
import socket
import time
import ssl
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cutover', ROOT / 'scripts/prod/cutover.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def prepare_images(run, backend, frontend, *, existing):
    if existing:
        for image in (backend, frontend):
            run(['docker', 'pull', image])
    else:
        run(['docker', 'build', '-f', 'Backend/Dockerfile', '--target', 'prod', '-t', backend, '.'])
        run(['docker', 'build', '-f', 'Frontend/Dockerfile', '-t', frontend, '.'])


def validate_images(parser, backend, frontend):
    if bool(backend) != bool(frontend):
        parser.error('Supply both --backend-image and --frontend-image, or neither.')
    for image in (backend, frontend):
        if image and not re.fullmatch(r'[^\s@]+@sha256:[0-9a-f]{64}', image):
            parser.error(
                'Existing images must use repository@sha256:<digest>; tags are not accepted.'
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--snapshot',
        type=Path,
        help='Optional historical dump; restored ONLY into the unique disposable test database',
    )
    parser.add_argument(
        '--repair-known-legacy-override',
        action='store_true',
        help='Apply the user-reviewed Plan 4/item 0/ingredient 117 repair ONLY in the disposable copy of the exact known dump',
    )
    parser.add_argument('--backend-image', help='Existing published backend digest; skips builds')
    parser.add_argument('--frontend-image', help='Existing published frontend digest; skips builds')
    args = parser.parse_args()
    validate_images(parser, args.backend_image, args.frontend_image)
    if args.repair_known_legacy_override and (
        not args.snapshot
        or hashlib.sha256(args.snapshot.read_bytes()).hexdigest()
        != 'f6be0266f82b5ce6956a85f92dd40afe06618c53f1ef640f22a8796f3973f88c'
    ):
        parser.error('Reviewed repair applies only to the exact November 2025 dump.')
    project = 'nutrition-release-' + uuid4().hex[:12]
    image = args.backend_image or project + ':candidate'
    frontend = args.frontend_image or project + ':frontend'
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    origin = f'https://localhost:{port}'
    env = dict(os.environ)
    for key in (
        'COMPOSE_PROFILES',
        'COMPOSE_FILE',
        'DATABASE_URL',
        'SQLALCHEMY_DATABASE_URI',
        'PGOPTIONS',
    ):
        env.pop(key, None)

    def run(args, **kwargs):
        return subprocess.run(args, cwd=ROOT, env=env, check=True, text=True, **kwargs)

    with tempfile.TemporaryDirectory(prefix=project) as directory:
        folder = Path(directory)
        openssl = shutil.which('openssl') or 'C:/Program Files/Git/usr/bin/openssl.exe'
        run(
            [
                openssl,
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-nodes',
                '-days',
                '1',
                '-keyout',
                str(folder / 'key.pem'),
                '-out',
                str(folder / 'cert.pem'),
                '-subj',
                '/CN=localhost',
                '-addext',
                'subjectAltName=DNS:localhost',
            ]
        )
        (folder / 'nginx.conf').write_text(
            'server { listen 443 ssl; ssl_certificate /cert/cert.pem; ssl_certificate_key /cert/key.pem; location /api/ { proxy_pass http://backend:8000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; } location / { proxy_pass http://frontend:80; } }'
        )
        config = {
            'services': {
                'db': {
                    'image': 'postgres:13',
                    'environment': {
                        'POSTGRES_USER': 'nutrition_test',
                        'POSTGRES_PASSWORD': 'disposable-test-only',
                        'POSTGRES_DB': 'nutrition_test',
                    },
                    'healthcheck': {
                        'test': ['CMD-SHELL', 'pg_isready -U nutrition_test -d nutrition_test'],
                        'interval': '1s',
                        'timeout': '5s',
                        'retries': 30,
                    },
                },
                'backend': {
                    'image': image,
                    'environment': {
                        'DATABASE_URL': 'postgresql://nutrition_test:disposable-test-only@db:5432/nutrition_test',
                        'ENVIRONMENT': 'production',
                        'DB_AUTO_CREATE': 'false',
                        'CORS_ALLOW_ORIGINS': origin,
                    },
                },
                **{
                    s: {'image': image, 'profiles': ['maintenance'], 'command': ['true']}
                    for s in ('edge', 'frontend', 'usda-sync')
                },
            }
        }
        # nginx resolves upstream names at startup; start dependencies first.
        config['services']['frontend'] = {
            'image': frontend,
            'depends_on': {'backend': {'condition': 'service_started'}},
        }
        config['services']['edge'] = {
            'image': 'nginx:stable-alpine',
            'depends_on': {service: {'condition': 'service_started'}
                           for service in ('backend', 'frontend')},
            'ports': [f'127.0.0.1:{port}:443'],
            'volumes': [
                str(folder / 'nginx.conf') + ':/etc/nginx/conf.d/default.conf:ro',
                str(folder) + ':/cert:ro',
            ],
        }
        compose_file = folder / 'compose.json'
        compose_file.write_text(json.dumps(config))
        compose = ['docker', 'compose', '-p', project, '-f', str(compose_file)]
        try:
            prepare_images(run, image, frontend, existing=bool(args.backend_image))
            run(compose + ['up', '-d', '--wait', 'db'])
            c = module.Cutover.__new__(module.Cutover)
            c.directory = folder / 'evidence'
            c.directory.mkdir()
            c.path = c.directory / 'cutover.json'
            c.state = {'stage': 'prepared', 'candidate': {}}
            c.compose, c.env = compose, env
            if args.snapshot:
                container = c.dc('ps', '-q', 'db', capture=True).strip()
                run(['docker', 'cp', str(args.snapshot.resolve()), container + ':/tmp/legacy.dump'])
                c.dc(
                    'exec',
                    '-T',
                    'db',
                    'pg_restore',
                    '--exit-on-error',
                    '--no-owner',
                    '--no-privileges',
                    '-U',
                    'nutrition_test',
                    '-d',
                    'nutrition_test',
                    '/tmp/legacy.dump',
                )
                starting_revision = c.sql('SELECT version_num FROM alembic_version')
            else:
                c.app('-m', 'alembic', '-c', 'Backend/alembic.ini', 'upgrade', module.CHECKPOINT)
                c.sql(
                    "INSERT INTO ingredients(name) VALUES ('Legacy duplicate'), ('Legacy duplicate'); INSERT INTO ingredient_units(ingredient_id,name,grams) SELECT min(id),'1 g',1 FROM ingredients; INSERT INTO foods(name) VALUES ('Legacy recipe'); INSERT INTO food_ingredients(food_id,ingredient_id,unit_id,unit_quantity) SELECT (SELECT min(id) FROM foods),min(ingredient_id),min(id),10 FROM ingredient_units"
                )
                starting_revision = module.CHECKPOINT
            # Wrong revisions stop before backup/migration and leave applications stopped.
            try:
                c.maintenance('wrong-revision')
                raise AssertionError('Wrong revision accepted')
            except ValueError:
                assert c.state['stage'] == 'prepared'
            c.maintenance(starting_revision)
            assert c.state['restore_verified']
            c.expand()
            if args.repair_known_legacy_override:
                # Approved by the user for this disposable rehearsal; never change the input dump.
                assert (
                    c.sql(
                        "SELECT (payload->'plan'->0->>'foodId' = '11' AND payload::jsonb->'plan'->0->'overrides'->'117' = '{\"unitId\":77,\"quantity\":1}'::jsonb)::text FROM plans WHERE id=4"
                    )
                    == 'true'
                )
                assert (
                    c.sql(
                        'SELECT count(*) FROM food_ingredients WHERE food_id=11 AND ingredient_id=117'
                    )
                    == '0'
                )
                c.sql(
                    "UPDATE plans SET payload = payload::jsonb #- '{plan,0,overrides,117}' WHERE id=4"
                )
            c.app(
                '-m',
                'Backend.commands.create_admin',
                '--email',
                'admin@example.invalid',
                '--display-name',
                'Admin',
                '--password-stdin',
                input='test-only-password\n',
            )
            c.app(
                '-m',
                'Backend.commands.manage_account',
                'create-user',
                '--email',
                'owner@example.invalid',
                '--display-name',
                'Owner',
                '--password-stdin',
                input='test-only-password\n',
            )
            c.report('owner@example.invalid')
            before = c.snapshot()
            try:
                c.finalize('0' * 64)
                raise AssertionError('Unreviewed report accepted')
            except ValueError:
                assert c.snapshot() == before
            c.finalize(c.state['report_sha256'])
            assert c.sql('SELECT version_num FROM alembic_version') == module.HEAD
            assert c.sql('SELECT count(*) FROM ingredients WHERE user_id IS NULL') == '0'
            assert (
                c.state['before']['tables']['ingredients']['count']
                == c.state['after']['tables']['ingredients']['count']
            )
            env['RELEASE_INGREDIENT_ID'] = c.sql('SELECT min(id) FROM ingredients')
            c.stopped()
            c.app(
                '-m',
                'Backend.commands.manage_account',
                'create-user',
                '--email',
                'other@example.invalid',
                '--display-name',
                'Other',
                '--password-stdin',
                input='test-only-password\n',
            )
            c.dc('up', '-d', 'backend', 'frontend', 'edge')
            tls = ssl.create_default_context(cafile=str(folder / 'cert.pem'))
            for attempt in range(90):
                try:
                    with urllib.request.urlopen(
                        origin + '/api/health/ready', context=tls, timeout=3
                    ) as response:
                        assert response.status == 200
                    break
                except (OSError, AssertionError) as error:
                    last_readiness_error = repr(error)
                    time.sleep(1)
            else:
                print('Last readiness error:', last_readiness_error, flush=True)
                subprocess.run(compose + ['ps', '-a'], cwd=ROOT, env=env, check=False)
                subprocess.run(compose + ['logs', '--no-color', '--tail', '100',
                                          'edge', 'backend', 'frontend'],
                               cwd=ROOT, env=env, check=False)
                raise RuntimeError('HTTPS production stack did not become ready')
            env.update(
                RELEASE_HTTPS_ORIGIN=origin,
                RELEASE_LOCAL_CERT='1',
                RELEASE_USER_A='owner@example.invalid',
                RELEASE_USER_B='other@example.invalid',
                RELEASE_PASSWORD='test-only-password',
            )
            run(['node', 'testsupport/release_https_smoke.cjs'])
            print(
                json.dumps(
                    {
                        'image_id': run(
                            ['docker', 'image', 'inspect', '--format', '{{.Id}}', image],
                            capture_output=True,
                        ).stdout.strip(),
                        'backend_reference': image,
                        'frontend_reference': frontend,
                        'image_mode': 'published-digests' if args.backend_image else 'local-build',
                        'restore_verified': True,
                        'reviewed_repair': (
                            'Plan 4/item 0: removed stale ingredient 117 override'
                            if args.repair_known_legacy_override
                            else None
                        ),
                        'starting_revision': starting_revision,
                        'frontend_image_id': run(
                            ['docker', 'image', 'inspect', '--format', '{{.Id}}', frontend],
                            capture_output=True,
                        ).stdout.strip(),
                        'snapshot_sha256': (
                            hashlib.sha256(args.snapshot.read_bytes()).hexdigest()
                            if args.snapshot
                            else None
                        ),
                        'counts': {
                            name: row['count'] for name, row in c.state['before']['tables'].items()
                        },
                        'ending_revision': module.HEAD,
                        'table_counts_preserved': True,
                        'failure_injection': ['wrong-revision', 'unapproved-report'],
                    },
                    indent=2,
                )
            )
        finally:
            run(compose + ['--profile', 'maintenance', 'down', '--volumes', '--remove-orphans'])
            if not args.backend_image:
                subprocess.run(['docker', 'image', 'rm', image, frontend], cwd=ROOT, check=False)


if __name__ == '__main__':
    main()
