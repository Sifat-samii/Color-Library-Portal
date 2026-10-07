ALTER TABLE colors
  ADD COLUMN IF NOT EXISTS collection text NOT NULL DEFAULT 'SEASONAL';

ALTER TABLE colors DROP CONSTRAINT IF EXISTS colors_collection_check;
ALTER TABLE colors
  ADD CONSTRAINT colors_collection_check CHECK (collection IN ('CORE', 'SEASONAL'));
