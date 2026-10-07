DELETE FROM sync_jobs AS job
USING reference_versions AS version
WHERE job.reference_version_id = version.id
  AND job.status = 'FAILED'
  AND version.synced_at IS NOT NULL;
