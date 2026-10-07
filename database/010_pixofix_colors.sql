CREATE TABLE IF NOT EXISTS pixofix_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_code text NOT NULL UNIQUE,
  name text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pixofix_colors_name ON pixofix_colors(name);
