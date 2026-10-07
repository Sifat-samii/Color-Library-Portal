CREATE TABLE IF NOT EXISTS color_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  color_id uuid NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  details text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'IN_EDIT', 'COMPLETED', 'REJECTED')),
  created_by uuid REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (length(btrim(details)) > 0),
  CHECK (length(btrim(reason)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS color_edit_requests_one_open
  ON color_edit_requests (color_id)
  WHERE status IN ('PENDING', 'IN_EDIT');

CREATE INDEX IF NOT EXISTS color_edit_requests_color
  ON color_edit_requests (color_id, created_at DESC);

ALTER TABLE color_request_deliveries
  ADD COLUMN IF NOT EXISTS reference_kind text NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS reference_label text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'color_request_deliveries_reference_kind_check'
  ) THEN
    ALTER TABLE color_request_deliveries
      ADD CONSTRAINT color_request_deliveries_reference_kind_check
      CHECK (reference_kind IN ('FULL', 'QUICK', 'OTHER'));
  END IF;
END $$;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'color_request_deliveries'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%version_number%'
    AND pg_get_constraintdef(con.oid) NOT ILIKE '%reference_kind%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE color_request_deliveries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS color_request_deliveries_category_version
  ON color_request_deliveries (request_id, reference_kind, reference_label, version_number);

DROP INDEX IF EXISTS idx_color_request_one_in_review;

CREATE UNIQUE INDEX IF NOT EXISTS idx_color_request_category_in_review
  ON color_request_deliveries (request_id, reference_kind, reference_label)
  WHERE status = 'IN_REVIEW';
