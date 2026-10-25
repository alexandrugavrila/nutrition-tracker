"""Explicit production cutover checkpoints shared by PowerShell and Bash.

No automatic recovery, database replacement, or public reopening on failure.
Requires Python 3.11+ and Docker Compose on the operator host.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import sys
from uuid import uuid4
from urllib.parse import urlparse, unquote
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CHECKPOINT = 'b42d8f0a315c'
HEAD = 'e75a1c3d648f'


class Cutover:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.path = self.directory / 'cutover.json'
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.compose = [
            'docker',
            'compose',
            '--env-file',
            str(ROOT / '.env.production'),
            '-f',
            str(ROOT / 'docker-compose.prod.yml'),
        ]
        self.env = dict(os.environ)
        # Pin application commands to the recorded candidate after prepare.
        self.env.update(self.state.get('candidate', {}))
        if self.state and self.state.get('configuration_sha256') != self.configuration_hash():
            raise ValueError('Production database/project configuration changed since prepare.')

    def configuration_hash(self):
        config = json.loads(self.dc('config', '--format', 'json', capture=True))
        backend_env = config['services']['backend']['environment']
        db_env = config['services']['db']['environment']
        database_url = backend_env.get('SQLALCHEMY_DATABASE_URI') or backend_env['DATABASE_URL']
        parsed = urlparse(database_url)
        if (
            parsed.hostname != 'db'
            or parsed.port not in (None, 5432)
            or unquote(parsed.path.lstrip('/')) != db_env['POSTGRES_DB']
            or unquote(parsed.username or '') != db_env['POSTGRES_USER']
            or unquote(parsed.password or '') != db_env['POSTGRES_PASSWORD']
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                'Backend database must match the Compose db service exactly for this cutover.'
            )
        if backend_env.get('DB_AUTO_CREATE', 'false').lower() != 'false':
            raise ValueError('DB_AUTO_CREATE must be false for a migration-controlled release.')
        for service in ('backend', 'frontend', 'usda-sync'):
            if service in config['services']:
                config['services'][service].pop('image', None)
        return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()

    def run(self, args, *, capture=False, input=None):
        return subprocess.run(
            args,
            cwd=ROOT,
            env=self.env,
            check=True,
            text=True,
            input=input,
            stdout=subprocess.PIPE if capture else None,
        ).stdout

    def dc(self, *args, **kwargs):
        return self.run(self.compose + list(args), **kwargs)

    def app(self, *args, **kwargs):
        return self.dc('run', '--rm', '--no-deps', '-T', 'backend', 'python', *args, **kwargs)

    def save(self, stage):
        self.state['stage'] = stage
        self.state.setdefault('checkpoints', {})[stage] = datetime.now(timezone.utc).isoformat()
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.state, indent=2) + '\n')
        temporary.replace(self.path)

    def require(self, stage):
        if self.state.get('stage') != stage:
            raise ValueError(f'Requires checkpoint {stage}; found {self.state.get("stage")}.')

    def stopped(self):
        # Includes maintenance and one-off containers, not just named app services.
        raw = self.dc('ps', '--all', '--format', 'json', capture=True).strip()
        containers = (
            json.loads(raw or '[]')
            if raw.startswith('[') or '\n' not in raw
            else [json.loads(line) for line in raw.splitlines()]
        )
        if isinstance(containers, dict):
            containers = [containers]
        if any(c.get('State') == 'running' and c.get('Service') != 'db' for c in containers):
            raise ValueError('All application/maintenance/one-off writers must be stopped.')

    def sql(self, statement, database=None):
        config = json.loads(self.dc('config', '--format', 'json', capture=True))
        db = config['services']['db']['environment']
        return self.dc(
            'exec',
            '-T',
            'db',
            'psql',
            '-U',
            db['POSTGRES_USER'],
            '-d',
            database or db['POSTGRES_DB'],
            '-v',
            'ON_ERROR_STOP=1',
            '-Atc',
            statement,
            capture=True,
        ).strip()

    def snapshot(self, database=None):
        if database is None:
            return json.loads(self.app('-m', 'Backend.commands.release_snapshot', capture=True))
        # Override only the DB name, keeping credentials private inside the container.
        code = (
            "import os; from sqlalchemy.engine import make_url; u=make_url(os.environ.get('SQLALCHEMY_DATABASE_URI') or os.environ['DATABASE_URL']); os.environ['SQLALCHEMY_DATABASE_URI']=os.environ['DATABASE_URL']=u.set(database="
            + repr(database)
            + ").render_as_string(hide_password=False); from Backend.commands.release_snapshot import main; main()"
        )
        return json.loads(self.app('-c', code, capture=True))

    def prepare(self, backend, frontend):
        if self.path.exists():
            raise ValueError('Use a new evidence directory for a new cutover.')
        for value in (backend, frontend):
            if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', value or ''):
                raise ValueError('Both candidate images must be repository@sha256:<digest>.')
        config = json.loads(self.dc('config', '--format', 'json', capture=True))
        previous = {}
        for service in ('backend', 'frontend', 'db', 'edge'):
            ids = self.dc('ps', '-q', service, capture=True).strip()
            if ids:
                previous[service] = json.loads(self.run(['docker', 'inspect', ids], capture=True))[
                    0
                ]['Image']
        for image in (backend, frontend):
            self.run(['docker', 'pull', image])
        self.directory.mkdir(parents=True, exist_ok=True)
        self.state = {
            'candidate': {'BACKEND_IMAGE': backend, 'FRONTEND_IMAGE': frontend},
            'previous_image_ids': previous,
            'previous_images': {
                s: config['services'][s]['image'] for s in ('backend', 'frontend', 'db', 'edge')
            },
            'source_commit': self.run(['git', 'rev-parse', 'HEAD'], capture=True).strip(),
        }
        self.state['configuration_sha256'] = self.configuration_hash()
        self.save('prepared')

    def maintenance(self, expected):
        self.require('prepared')
        # Stop profile services too. Do not stop/recreate the database.
        self.dc('--profile', 'maintenance', 'stop', 'edge', 'frontend', 'backend', 'usda-sync')
        self.stopped()
        exists = self.sql("SELECT to_regclass('public.alembic_version') IS NOT NULL")
        if exists == 't':
            revision = self.sql(
                "SELECT string_agg(version_num, ',' ORDER BY version_num) FROM alembic_version"
            )
        elif (
            self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
            == '0'
        ):
            revision = 'base'
        else:
            raise ValueError('Unversioned populated database; stamping is prohibited.')
        if revision != expected:
            raise ValueError(
                'Starting revision differs from the rehearsed revision; access remains closed.'
            )
        size = int(self.sql('SELECT pg_database_size(current_database())'))
        if shutil.disk_usage(self.directory).free < size * 3:
            raise ValueError(
                'Insufficient host free space for backup evidence (requires 3x database size).'
            )
        self.state['database_size_bytes'] = size
        self.state['starting_revision'] = revision
        self.state['before'] = self.snapshot()
        config = json.loads(self.dc('config', '--format', 'json', capture=True))
        db = config['services']['db']['environment']
        temp = '/tmp/cutover-' + uuid4().hex + '.dump'
        self.dc(
            'exec',
            '-T',
            'db',
            'pg_dump',
            '-U',
            db['POSTGRES_USER'],
            '-d',
            db['POSTGRES_DB'],
            '-Fc',
            '--no-owner',
            '--no-privileges',
            '-f',
            temp,
        )
        container = self.dc('ps', '-q', 'db', capture=True).strip()
        dump = self.directory / 'before.dump'
        self.run(['docker', 'cp', container + ':' + temp, str(dump)])
        self.state['backup_sha256'] = hashlib.sha256(dump.read_bytes()).hexdigest()
        # Restore into a brand-new database; never DROP/clean the source database.
        restore = 'cutover_verify_' + uuid4().hex
        self.sql('CREATE DATABASE ' + restore)
        try:
            self.dc(
                'exec',
                '-T',
                'db',
                'pg_restore',
                '--exit-on-error',
                '--no-owner',
                '--no-privileges',
                '-U',
                db['POSTGRES_USER'],
                '-d',
                restore,
                temp,
            )
            if self.snapshot(restore) != self.state['before']:
                raise ValueError('Restored snapshot differs from the stopped source database.')
        finally:
            self.sql('DROP DATABASE ' + restore)
            self.dc('exec', '-T', 'db', 'rm', '-f', temp)
        self.state['restore_verified'] = True
        self.save('backed-up')

    def expand(self):
        self.require('backed-up')
        self.stopped()
        if (
            hashlib.sha256((self.directory / 'before.dump').read_bytes()).hexdigest()
            != self.state['backup_sha256']
        ):
            raise ValueError('Backup checksum mismatch.')
        self.app('-m', 'alembic', '-c', 'Backend/alembic.ini', 'upgrade', CHECKPOINT)
        self.save('expanded')

    def report(self, owner):
        self.require('expanded')
        self.stopped()
        try:
            report = self.app(
                '-m', 'Backend.commands.adopt_legacy', '--email', owner, '--dry-run', capture=True
            )
        except subprocess.CalledProcessError as exc:
            if not exc.stdout:
                raise
            report = exc.stdout
        data = json.loads(report)
        if data.get('blockers'):
            (self.directory / 'adoption-blocked.json').write_text(report)
            raise ValueError('Adoption blocked: ' + '; '.join(data['blockers']))
        (self.directory / 'adoption.json').write_text(report)
        self.state['owner'] = owner
        self.state['report_sha256'] = hashlib.sha256(report.encode()).hexdigest()
        self.save('review-required')

    def finalize(self, approved_hash):
        self.require('review-required')
        self.stopped()
        report = (self.directory / 'adoption.json').read_text()
        actual = hashlib.sha256(report.encode()).hexdigest()
        if actual != approved_hash or actual != self.state['report_sha256']:
            raise ValueError('Supply the SHA256 of the exact reviewed adoption report.')
        code = (
            "import sys,tempfile; from pathlib import Path; from Backend.commands.adopt_legacy import main; d=tempfile.TemporaryDirectory(); p=Path(d.name)/'report.json'; p.write_text(sys.stdin.read()); raise SystemExit(main(['--email',"
            + repr(self.state['owner'])
            + ", '--apply', '--report', str(p)]))"
        )
        self.app('-c', code, input=report)
        self.app('-m', 'alembic', '-c', 'Backend/alembic.ini', 'upgrade', HEAD)
        self.app('-m', 'alembic', '-c', 'Backend/alembic.ini', 'check')
        self.state['after'] = self.snapshot()
        for name in (
            'ingredients',
            'foods',
            'plans',
            'stored_food',
            'daily_log_entries',
            'ingredient_units',
            'food_ingredients',
        ):
            before = self.state['before']['tables'].get(name)
            after = self.state['after']['tables'].get(name)
            if before and (
                not after
                or before['count'] != after['count']
                or before['ids_sha256'] != after['ids_sha256']
            ):
                raise ValueError(
                    'Historical row IDs/counts changed; keep access closed and investigate.'
                )
        self.save('finalized')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'maintenance', 'expand', 'report', 'finalize'])
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--backend')
    parser.add_argument('--frontend')
    parser.add_argument('--expected-revision')
    parser.add_argument('--owner-email')
    parser.add_argument('--approved-report-sha256')
    args = parser.parse_args(argv)
    required = {
        'prepare': ['backend', 'frontend'],
        'maintenance': ['expected_revision'],
        'report': ['owner_email'],
        'finalize': ['approved_report_sha256'],
    }
    if any(not getattr(args, field) for field in required.get(args.stage, [])):
        parser.error('Missing required arguments for this checkpoint.')
    try:
        cutover = Cutover(args.evidence)
        if args.stage == 'prepare':
            cutover.prepare(args.backend, args.frontend)
        elif args.stage == 'maintenance':
            cutover.maintenance(args.expected_revision)
        elif args.stage == 'expand':
            cutover.expand()
        elif args.stage == 'report':
            cutover.report(args.owner_email)
        elif args.stage == 'finalize':
            cutover.finalize(args.approved_report_sha256)
        print(
            'Checkpoint complete. Public access remains closed after maintenance. See the release runbook.'
        )
        return 0
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (OSError, subprocess.CalledProcessError):
        print(
            'Cutover checkpoint failed. Do not reopen access. Inspect local evidence and the recovery runbook; no automatic rollback was attempted.',
            file=sys.stderr,
        )
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
