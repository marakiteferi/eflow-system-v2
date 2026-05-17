-- 08_verification_and_import.sql

-- 1. Create document_verification_links table
CREATE TABLE IF NOT EXISTS document_verification_links (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    purpose TEXT,
    expires_at TIMESTAMPTZ,
    max_uses INTEGER,
    access_count INTEGER DEFAULT 0,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_verification_token ON document_verification_links(token);

-- Index for document lookups by submitter
CREATE INDEX IF NOT EXISTS idx_verification_document ON document_verification_links(document_id);
