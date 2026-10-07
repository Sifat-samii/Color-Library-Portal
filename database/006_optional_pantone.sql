DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'color_requests'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%pantone%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE color_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
