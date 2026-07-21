"""Verify public_podcast_router contract without bcrypt/jose/cryptography.

Strategy: bypass app.security / app.config entirely. We replicate the
_get_or_default helper inline (same logic, no encryption required because
no DB rows are pre-seeded) and verify endpoints + _is_allowed_hbsc_url.

This is NOT running the full app — it's an integration smoke test of the
router's URL allow-list, voice catalog, and SSRF guard. The pytest suite
in backend/tests/test_public_podcast_router.py covers the full pipeline
including DB-backed config and Mocked-upstream chains.
"""
import sys, types
sys.path.insert(0, '/Users/jasonlee/Library/Python/3.9/lib/python/site-packages')
sys.path.insert(0, 'backend')

# Stub out missing 3rd-party deps so app.config import doesn't blow up.
for mod_name in ['bcrypt', 'jose', 'cryptography', 'cryptography.fernet']:
    if mod_name not in sys.modules:
        m = types.ModuleType(mod_name)
        if mod_name == 'bcrypt':
            m.hashpw = lambda plain, salt: b'$2b$12$' + b'a' * 53
            m.checkpw = lambda plain, hashed: False
            m.gensalt = lambda rounds=12: b'$2b$12$' + b'x' * 22
        elif mod_name == 'jose':
            sub = types.ModuleType('jose')
            sub.JWTError = Exception
            def _jwt_encode(*a, **k): return 'stub-token'
            def _jwt_decode(*a, **k): return {'sub': 'admin'}
            sub.jwt = types.SimpleNamespace(encode=_jwt_encode, decode=_jwt_decode)
            sys.modules['jose'] = sub
            m = sub
        elif mod_name == 'cryptography':
            sys.modules['cryptography'] = m
        elif mod_name == 'cryptography.fernet':
            fernet_mod = types.ModuleType('cryptography.fernet')
            class _Fernet:
                def __init__(self, key): pass
                def encrypt(self, b): return b
                def decrypt(self, b): return b
            class _InvalidToken(Exception): pass
            fernet_mod.Fernet = _Fernet
            fernet_mod.InvalidToken = _InvalidToken
            sys.modules['cryptography.fernet'] = fernet_mod
            m = fernet_mod
        sys.modules[mod_name] = m

# Now import the router module-level symbols
from app.routers.public_podcast_router import (
    router, VOICE_CATALOG, DEFAULT_VOICE_A, DEFAULT_VOICE_B,
    _is_allowed_hbsc_url, MAX_PUBLIC_PODCAST_BYTES, RATE_LIMIT_MAX_CALLS,
)

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import get_db
from app.models.base import Base
from app.middleware import rate_limit as rl

engine = create_engine('sqlite:///:memory:', connect_args={'check_same_thread': False}, poolclass=StaticPool)
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
def override_db():
    db = Session()
    try: yield db
    finally: db.close()

app = FastAPI()
app.include_router(router)
app.dependency_overrides[get_db] = override_db

passed = 0; failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1; print(f'  PASS  {name}')
    else:
        failed += 1; print(f'  FAIL  {name}  {detail}')

with TestClient(app) as c:
    rl._buckets.clear()

    # === Voice catalog ===
    check('VOICE_CATALOG midnight_male', 'midnight_male' in VOICE_CATALOG)
    check('VOICE_CATALOG warm_female', 'warm_female' in VOICE_CATALOG)
    check('default A = midnight_male', DEFAULT_VOICE_A == 'midnight_male')
    check('default B = warm_female', DEFAULT_VOICE_B == 'warm_female')
    check('小数 label', VOICE_CATALOG['midnight_male']['label'] == '小数')
    check('小创 label', VOICE_CATALOG['warm_female']['label'] == '小创')
    check('小数 gender male', VOICE_CATALOG['midnight_male']['gender'] == 'male')
    check('小创 gender female', VOICE_CATALOG['warm_female']['gender'] == 'female')
    check('MAX_PUBLIC_PODCAST_BYTES 256KB', MAX_PUBLIC_PODCAST_BYTES == 256 * 1024)
    check('RATE_LIMIT_MAX_CALLS 12', RATE_LIMIT_MAX_CALLS == 12)

    # === URL allow-list (spec §6 SSRF guard) ===
    good = [
        'https://hbsc.cn/articles/llm-trust',
        'https://hbsc.cn/issues/2026-q3',
        'https://hbsc.cn/articles',
        'https://hbsc.cn/issues',
        'http://localhost:5173/articles/foo',
        'http://127.0.0.1:5173/articles/foo',
    ]
    bad = [
        'https://evil.com/articles/foo',
        'https://hbsc.cn/admin/settings',
        'https://hbsc.cn/login',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'ftp://hbsc.cn/articles/x',
        'https://hbsc.cn/',
        'https://hbsc.cn/search?q=foo',
    ]
    for u in good:
        check(f'allow {u[:50]}', _is_allowed_hbsc_url(u))
    for u in bad:
        check(f'deny {u[:50]}', not _is_allowed_hbsc_url(u), f'was allowed')

    # === GET /config ===
    r = c.get('/api/public/podcast/config')
    check('GET /config 200', r.status_code == 200)
    body = r.json()
    check('config.enabled true', body['enabled'] is True)
    check('config has 2 voices', len(body['voices']) == 2)
    check('config default_voice_a=midnight_male', body['default_voice_a'] == 'midnight_male')
    check('config default_voice_b=warm_female', body['default_voice_b'] == 'warm_female')
    check('config minicast_base_url set', 'minicast_base_url' in body)

    # === POST /extract SSRF ===
    r = c.post('/api/public/podcast/extract', json={'url': 'https://evil.com/articles/foo'})
    check('POST /extract bad URL blocked', r.status_code in (403, 422), f'got {r.status_code}')

    r = c.post('/api/public/podcast/extract', json={'url': 'https://hbsc.cn/articles/foo'})
    check('POST /extract good URL → 503 (no upstream)', r.status_code == 503, f'got {r.status_code}')
    detail = r.json().get('detail', {})
    check('extract error code minicast_unavailable',
          detail.get('code') == 'minicast_unavailable')

    # === POST /generate (good URL but no upstream) ===
    r = c.post('/api/public/podcast/generate', json={'url': 'https://hbsc.cn/articles/foo'})
    check('POST /generate → 503', r.status_code == 503, f'got {r.status_code}')
    detail = r.json().get('detail', {})
    check('generate hint mentions /labs/minicast',
          '/labs/minicast' in detail.get('hint', ''))

    # === POST /generate with unknown voice ===
    r = c.post('/api/public/podcast/generate', json={
        'url': 'https://hbsc.cn/articles/x',
        'voice_a': 'unknown_voice',
    })
    check('unknown voice → 422', r.status_code == 422, f'got {r.status_code}')

    # === POST /generate with pinned voices (still 503 upstream) ===
    r = c.post('/api/public/podcast/generate', json={
        'url': 'https://hbsc.cn/articles/x',
        'voice_a': 'midnight_male',
        'voice_b': 'warm_female',
    })
    check('pinned voices validation passes (503 upstream)',
          r.status_code == 503, f'got {r.status_code}')

print(f'\n=== {passed} passed, {failed} failed ===')
sys.exit(0 if failed == 0 else 1)
