-- Columns used by the workflow engine and background jobs.

-- Users can be deactivated without deleting them; inactive users are skipped by load balancing.
ALTER TABLE users     ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE;

-- Delay nodes: when a paused document should continue.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS resume_at      TIMESTAMPTZ;

-- Escalate a missed deadline only once per step.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sla_escalated  BOOLEAN DEFAULT FALSE;

-- Hash of the final PDF after the approval certificate page is added,
-- so verification can tell whether the issued file was changed later.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS final_file_hash VARCHAR(64);

