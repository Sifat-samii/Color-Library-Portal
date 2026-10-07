-- Run this once in pgAdmin while connected to color_library_portal as postgres or
-- another PostgreSQL superuser. It preserves all existing application data.

BEGIN;

ALTER DATABASE color_library_portal OWNER TO "TUUO_ADMIN";
ALTER SCHEMA public OWNER TO "TUUO_ADMIN";
GRANT ALL ON SCHEMA public TO "TUUO_ADMIN";

DO $$
DECLARE
  object_record record;
BEGIN
  FOR object_record IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  LOOP
    CASE object_record.relkind
      WHEN 'S' THEN
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', object_record.relname, 'TUUO_ADMIN');
      WHEN 'v' THEN
        EXECUTE format('ALTER VIEW public.%I OWNER TO %I', object_record.relname, 'TUUO_ADMIN');
      WHEN 'm' THEN
        EXECUTE format('ALTER MATERIALIZED VIEW public.%I OWNER TO %I', object_record.relname, 'TUUO_ADMIN');
      ELSE
        EXECUTE format('ALTER TABLE public.%I OWNER TO %I', object_record.relname, 'TUUO_ADMIN');
    END CASE;
  END LOOP;
END $$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "TUUO_ADMIN";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "TUUO_ADMIN";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "TUUO_ADMIN";

COMMIT;
