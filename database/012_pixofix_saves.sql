CREATE TABLE IF NOT EXISTS pixofix_saves (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  color_id uuid NOT NULL REFERENCES pixofix_colors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, color_id)
);
