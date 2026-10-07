CREATE TABLE IF NOT EXISTS color_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  color_id uuid REFERENCES colors(id) ON DELETE SET NULL,
  proposed_name text,
  pantone text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'AWAITING_DELIVERY' CHECK (status IN ('AWAITING_DELIVERY', 'IN_PROGRESS', 'APPROVED')),
  published_version_id uuid REFERENCES reference_versions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(pantone)) > 0),
  CHECK (
    (color_id IS NOT NULL AND proposed_name IS NULL)
    OR (color_id IS NULL AND proposed_name IS NOT NULL AND length(btrim(proposed_name)) > 0)
  )
);

CREATE TABLE IF NOT EXISTS color_request_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES color_requests(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  profile_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS color_request_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES color_requests(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_REVIEW', 'REJECTED', 'APPROVED', 'WITHDRAWN')),
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  profile_label text NOT NULL,
  upload_note text NOT NULL DEFAULT '',
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_color_request_one_in_review
  ON color_request_deliveries(request_id)
  WHERE status = 'IN_REVIEW';

CREATE TABLE IF NOT EXISTS color_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES color_requests(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES color_request_deliveries(id) ON DELETE SET NULL,
  author_id uuid REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_color_requests_client_status
  ON color_requests(client_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_color_request_deliveries_request
  ON color_request_deliveries(request_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_color_request_comments_request
  ON color_request_comments(request_id, created_at);
