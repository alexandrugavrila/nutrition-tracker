"""Cookie mutation origin checks and database-backed login budgets."""

import hashlib
import time
from urllib.parse import urlsplit
from fastapi import HTTPException
from sqlalchemy import case
from Backend.models import LoginBudget


def trusted_origin(request, settings):
    if request.method in {'GET', 'HEAD', 'OPTIONS'}:
        return True
    if (
        not request.cookies.get(settings.session_cookie_name)
        and request.url.path != '/api/auth/login'
    ):
        return True
    raw = request.headers.get('origin')
    if raw is None and request.headers.get('referer'):
        parsed = urlsplit(request.headers['referer'])
        raw = f'{parsed.scheme}://{parsed.netloc}'
    allowed = {value.rstrip('/') for value in settings.allow_origins if value != '*'}
    allowed.add(str(request.base_url).rstrip('/'))
    return raw is not None and raw != 'null' and raw.rstrip('/') in allowed


def login_budget(db, email, address):
    """Atomic across processes. Fixed 15-minute windows; keys never contain PII."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    insert = pg_insert if db.bind.dialect.name == 'postgresql' else sqlite_insert
    window = int(time.time() // 900)
    limits = [
        (hashlib.sha256(('address:' + address).encode()).hexdigest(), 100),
        (hashlib.sha256(('account:' + email).encode()).hexdigest(), 10),
    ]
    exceeded = False
    for key, limit in limits:
        statement = insert(LoginBudget).values(key=key, window=window, attempts=1)
        statement = statement.on_conflict_do_update(
            index_elements=['key'],
            set_={
                'window': window,
                'attempts': case(
                    (
                        LoginBudget.window == window,
                        case(
                            (LoginBudget.attempts < limit + 1, LoginBudget.attempts + 1),
                            else_=limit + 1,
                        ),
                    ),
                    else_=1,
                ),
            },
        ).returning(LoginBudget.attempts)
        exceeded = db.execute(statement).scalar_one() > limit
        if exceeded:
            break
    # A bounded retention period prevents indefinite accumulation from random emails.
    from sqlalchemy import delete

    db.execute(delete(LoginBudget).where(LoginBudget.window < window - 96))
    db.commit()
    if exceeded:
        raise HTTPException(
            429,
            'Too many login attempts. Try again later.',
            headers={'Retry-After': str(900 - int(time.time()) % 900)},
        )
