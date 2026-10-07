CREATE INDEX IF NOT EXISTS idx_sync_jobs_client_status
  ON sync_jobs(client_id, status);

CREATE INDEX IF NOT EXISTS idx_audit_created_at
  ON audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_active_reference
  ON reference_versions(reference_id, status, version_number DESC)
  WHERE status <> 'REMOVED';
