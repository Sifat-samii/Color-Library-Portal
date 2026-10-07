ALTER TABLE colors
  ADD COLUMN IF NOT EXISTS hex_code text NOT NULL DEFAULT '';

WITH latest AS (
  SELECT DISTINCT ON (r.color_id) r.color_id, r.client_id, r.hex_code
  FROM color_requests r
  WHERE r.color_id IS NOT NULL
    AND r.status = 'APPROVED'
    AND r.hex_code <> ''
  ORDER BY r.color_id, r.updated_at DESC
), unique_hex AS (
  SELECT client_id, hex_code
  FROM latest
  GROUP BY client_id, hex_code
  HAVING count(*) = 1
)
UPDATE colors c
SET hex_code = latest.hex_code
FROM latest
JOIN unique_hex ON unique_hex.client_id = latest.client_id AND unique_hex.hex_code = latest.hex_code
WHERE c.id = latest.color_id
  AND c.archived_at IS NULL
  AND c.hex_code = '';

CREATE UNIQUE INDEX IF NOT EXISTS colors_client_hex_active
  ON colors (client_id, hex_code)
  WHERE archived_at IS NULL AND hex_code <> '';
