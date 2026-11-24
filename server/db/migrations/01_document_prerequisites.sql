CREATE TABLE IF NOT EXISTS document_prerequisites (
    id SERIAL PRIMARY KEY,
    parent_document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    required_workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
    fulfilled_by_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ
);
