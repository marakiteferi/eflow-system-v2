-- What the reviewer confirmed when approving a step: the step's required checklist
-- and the outcome they chose (used by "Branch on outcome" steps further on).
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS checklist_confirmed JSONB;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS outcome VARCHAR(100);
