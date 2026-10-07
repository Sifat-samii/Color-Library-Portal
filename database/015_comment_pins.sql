ALTER TABLE color_request_comments
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES color_request_sources(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pin_x numeric,
  ADD COLUMN IF NOT EXISTS pin_y numeric;

ALTER TABLE color_request_comments
  DROP CONSTRAINT IF EXISTS color_request_comments_pin_pair;
ALTER TABLE color_request_comments
  ADD CONSTRAINT color_request_comments_pin_pair
  CHECK ((pin_x IS NULL) = (pin_y IS NULL));

ALTER TABLE color_request_comments
  DROP CONSTRAINT IF EXISTS color_request_comments_pin_range;
ALTER TABLE color_request_comments
  ADD CONSTRAINT color_request_comments_pin_range
  CHECK (pin_x IS NULL OR (pin_x >= 0 AND pin_x <= 100 AND pin_y >= 0 AND pin_y <= 100));

ALTER TABLE color_request_comments
  DROP CONSTRAINT IF EXISTS color_request_comments_one_image;
ALTER TABLE color_request_comments
  ADD CONSTRAINT color_request_comments_one_image
  CHECK (source_id IS NULL OR delivery_id IS NULL);
