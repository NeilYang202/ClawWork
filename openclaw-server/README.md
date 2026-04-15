# openclaw-client backend

Python backend for OpenClaw desktop:

- auth/login + optional SSO device flow
- OBS upload service
- runtime config delivery (SSO/OBS/user-agent binding) from PostgreSQL
- optional Redis cache for config hot paths

## Requirements

- Python 3.14.3
- PostgreSQL 18
- (optional) Redis 8 (or 7+)

## Run

```bash
cd openclaw-client
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

Default bootstrap admin (configurable via `.env`):

- username: `admin`
- password: `admin123456`

## Redis password config

You can configure Redis with either:

1. `REDIS_URL` (for example `redis://:password@redis:6379/10`)
2. split fields: `REDIS_HOST` + `REDIS_PORT` + `REDIS_DB` + `REDIS_PASSWORD` (and optional `REDIS_USERNAME`, `REDIS_SSL`)

## Initialize database

```bash
psql "$DATABASE_URL" -f scripts/init_db.sql
```

## Important API

- `POST /api/auth/login`
- `POST /api/auth/sso/start`
- `POST /api/auth/sso/poll`
- `GET /api/client/public-config`
- `GET /api/client/runtime-config`
- `GET /api/admin/config`
- `PUT /api/admin/config`
- `POST /api/obs/upload`
