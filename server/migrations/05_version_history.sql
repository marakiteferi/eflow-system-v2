-- Migration 05: Document Version History
-- Saves a snapshot of every document version before a resubmission overwrites it

CREATE TABLE IF NOT EXISTS document_versions (
    id               SERIAL PRIMARY KEY,
    document_id      INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    version_number   INTEGER NOT NULL,
    file_path        VARCHAR(500) NOT NULL,
    extracted_text   TEXT,
    rejection_reason TEXT,
    submitted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc_id ON document_versions(document_id);
