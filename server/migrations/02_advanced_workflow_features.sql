-- Integrity columns on existing approvals table
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS document_hash VARCHAR(256),
  ADD COLUMN IF NOT EXISTS approval_signature VARCHAR(512),
  ADD COLUMN IF NOT EXISTS previous_approval_id INTEGER REFERENCES approvals(id),
  ADD COLUMN IF NOT EXISTS previous_approval_hash VARCHAR(256);

-- Hash of original document content
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(256);

-- Approver attachments (new table)
CREATE TABLE IF NOT EXISTS document_attachments (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id),
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
