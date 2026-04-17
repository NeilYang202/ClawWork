CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  sso_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sso_provider TEXT,
  ad_domain TEXT,
  obs_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  obs_endpoint TEXT,
  obs_bucket TEXT,
  obs_base_path TEXT,
  obs_access_key TEXT,
  obs_secret_key TEXT,
  obs_region TEXT,
  gateways_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_config_singleton CHECK (id = 1)
);

INSERT INTO app_config(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS sso_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS sso_provider TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS ad_domain TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_endpoint TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_bucket TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_base_path TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_access_key TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_secret_key TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS obs_region TEXT;
ALTER TABLE app_config ADD COLUMN IF NOT EXISTS gateways_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS user_agent_bindings (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workspace_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(username, gateway_id, agent_id)
);
ALTER TABLE user_agent_bindings ADD COLUMN IF NOT EXISTS workspace_path TEXT;

CREATE TABLE IF NOT EXISTS auth_device_codes (
  id BIGSERIAL PRIMARY KEY,
  device_code TEXT UNIQUE NOT NULL,
  user_code TEXT UNIQUE NOT NULL,
  provider TEXT,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS obs_upload_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  task_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size BIGINT NOT NULL DEFAULT 0,
  obs_bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  file_url TEXT,
  openclaw_path TEXT NOT NULL,
  content_sha256 TEXT,
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  source_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE obs_upload_records ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE obs_upload_records ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE obs_upload_records ADD COLUMN IF NOT EXISTS source_path TEXT;

CREATE INDEX IF NOT EXISTS idx_uab_username ON user_agent_bindings(username);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_uab_username_single'
  ) AND NOT EXISTS (
    SELECT username FROM user_agent_bindings GROUP BY username HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX uq_uab_username_single ON user_agent_bindings(username);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_obs_records_session ON obs_upload_records(session_key);
CREATE INDEX IF NOT EXISTS idx_obs_records_user_session ON obs_upload_records(username, session_key);
CREATE INDEX IF NOT EXISTS idx_obs_records_created_at ON obs_upload_records(created_at);
CREATE INDEX IF NOT EXISTS idx_obs_records_source_dedup ON obs_upload_records(username, source_kind, source_path, content_sha256);
