-- Add digital signature tracking to approvals
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS signature_drawing TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ DEFAULT NOW();
