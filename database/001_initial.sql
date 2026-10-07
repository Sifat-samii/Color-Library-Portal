CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  local_folder_path text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'CLIENT')),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'ADMIN' AND client_id IS NULL) OR (role = 'CLIENT' AND client_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_key text NOT NULL,
  color_code text,
  instructions text NOT NULL DEFAULT '',
  archived_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, normalized_key)
);

CREATE TABLE IF NOT EXISTS color_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  color_id uuid NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (color_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS color_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  color_id uuid NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('QUICK', 'FULL', 'OTHER')),
  label text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  active_approved_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (color_id, kind, label)
);

CREATE TABLE IF NOT EXISTS reference_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES color_references(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'UNAPPROVED', 'REMOVED')),
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  local_relative_path text,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  upload_note text NOT NULL DEFAULT '',
  uploaded_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (reference_id, version_number)
);

ALTER TABLE color_references
  DROP CONSTRAINT IF EXISTS color_references_active_approved_version_id_fkey;
ALTER TABLE color_references
  ADD CONSTRAINT color_references_active_approved_version_id_fkey
  FOREIGN KEY (active_approved_version_id) REFERENCES reference_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  reference_version_id uuid NOT NULL REFERENCES reference_versions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED')),
  destination_path text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_colors_client ON colors(client_id, archived_at, name);
CREATE INDEX IF NOT EXISTS idx_references_color ON color_references(color_id);
CREATE INDEX IF NOT EXISTS idx_versions_reference ON reference_versions(reference_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_versions_status ON reference_versions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_client_time ON audit_events(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
