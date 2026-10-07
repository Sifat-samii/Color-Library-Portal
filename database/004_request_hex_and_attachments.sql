ALTER TABLE color_requests
  ADD COLUMN IF NOT EXISTS hex_code text NOT NULL DEFAULT '';

ALTER TABLE color_request_sources
  DROP CONSTRAINT IF EXISTS color_request_sources_request_id_key;

CREATE INDEX IF NOT EXISTS idx_color_request_sources_request
  ON color_request_sources(request_id, created_at);
