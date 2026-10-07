ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_subject text,
  ADD COLUMN IF NOT EXISTS google_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_subject_unique
  ON users(google_subject)
  WHERE google_subject IS NOT NULL;

ALTER TABLE color_requests
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN IF NOT EXISTS source_pixofix_color_id uuid REFERENCES pixofix_colors(id) ON DELETE SET NULL;

UPDATE color_requests r
SET source_type = CASE
  WHEN EXISTS (SELECT 1 FROM color_request_sources s WHERE s.request_id=r.id) THEN 'UPLOADED'
  ELSE 'GENERATED'
END;

ALTER TABLE color_requests DROP CONSTRAINT IF EXISTS color_requests_source_type_check;
ALTER TABLE color_requests
  ADD CONSTRAINT color_requests_source_type_check
  CHECK (source_type IN ('GENERATED', 'UPLOADED', 'EXPLORE'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid=con.conrelid
  WHERE rel.relname='color_requests'
    AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%AWAITING_DELIVERY%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE color_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE color_requests
  ADD CONSTRAINT color_requests_status_check
  CHECK (status IN ('AWAITING_DELIVERY', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'APPROVED'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid=con.conrelid
  WHERE rel.relname='color_request_deliveries'
    AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%REJECTED%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE color_request_deliveries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE color_request_deliveries SET status='NEEDS_CHANGES' WHERE status='REJECTED';

ALTER TABLE color_request_deliveries
  ADD CONSTRAINT color_request_deliveries_status_check
  CHECK (status IN ('IN_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'WITHDRAWN'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid=con.conrelid
  WHERE rel.relname='user_access_requests'
    AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%DONE%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE user_access_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE user_access_requests SET status='AUTHORIZED' WHERE status='DONE';

ALTER TABLE user_access_requests
  ADD CONSTRAINT user_access_requests_status_check
  CHECK (status IN ('PENDING', 'AUTHORIZED', 'DISMISSED'));

CREATE TABLE IF NOT EXISTS activity_events (
  id bigserial PRIMARY KEY,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  request_id uuid REFERENCES color_requests(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_request_time
  ON activity_events(request_id, created_at, id);

CREATE INDEX IF NOT EXISTS activity_events_client_time
  ON activity_events(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_event_id bigint NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_url text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_user_id, activity_event_id)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread
  ON notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_time
  ON notifications(recipient_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state_hash text PRIMARY KEY,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_login_states_expiry
  ON oauth_login_states(expires_at);

INSERT INTO activity_events(client_id, request_id, actor_user_id, event_type, subject_type, subject_id, metadata, created_at)
SELECT r.client_id, r.id, r.created_by, 'REQUEST_CREATED', 'color_request', r.id::text,
       jsonb_build_object('colorName', coalesce(c.name, r.proposed_name), 'hexCode', r.hex_code), r.created_at
FROM color_requests r
LEFT JOIN colors c ON c.id=r.color_id;

INSERT INTO activity_events(client_id, request_id, actor_user_id, event_type, subject_type, subject_id, metadata, created_at)
SELECT r.client_id, d.request_id, d.uploaded_by, 'REFERENCE_UPLOADED', 'color_request_delivery', d.id::text,
       jsonb_build_object('filename', d.original_filename, 'version', d.version_number, 'referenceKind', d.reference_kind, 'referenceLabel', d.reference_label), d.created_at
FROM color_request_deliveries d
JOIN color_requests r ON r.id=d.request_id;

INSERT INTO activity_events(client_id, request_id, actor_user_id, event_type, subject_type, subject_id, metadata, created_at)
SELECT r.client_id, c.request_id, c.author_id, 'COMMENT_ADDED', 'color_request_comment', c.id::text,
       jsonb_build_object('body', c.body, 'deliveryId', c.delivery_id), c.created_at
FROM color_request_comments c
JOIN color_requests r ON r.id=c.request_id;

INSERT INTO activity_events(client_id, request_id, actor_user_id, event_type, subject_type, subject_id, metadata, created_at)
SELECT a.client_id, a.entity_id::uuid, a.actor_user_id,
       CASE WHEN a.action='APPROVE' THEN 'REQUEST_APPROVED' ELSE 'CHANGES_REQUESTED' END,
       'color_request', a.entity_id, coalesce(a.after_data, '{}'::jsonb), a.created_at
FROM audit_events a
WHERE a.entity_type='color_request'
  AND a.action IN ('APPROVE', 'REJECT')
  AND a.entity_id ~* '^[0-9a-f-]{36}$'
  AND EXISTS (SELECT 1 FROM color_requests r WHERE r.id=a.entity_id::uuid);
