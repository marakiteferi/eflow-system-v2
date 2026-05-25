-- ============================================================
-- Migration: Workflow Builder Fixes
-- Run once against the eflow database
-- ============================================================

-- Fix 1: Add can_approve flag to dynamic_roles
-- Default TRUE so existing roles keep working; Student (id=1) is set FALSE below
ALTER TABLE dynamic_roles ADD COLUMN IF NOT EXISTS can_approve BOOLEAN NOT NULL DEFAULT TRUE;

-- Students cannot be approvers
UPDATE dynamic_roles SET can_approve = FALSE WHERE id = 1;

-- Fix 4: Persistent in-app notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    body        TEXT,
    type        TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'danger' | 'success'
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read  ON notifications(user_id, is_read);
