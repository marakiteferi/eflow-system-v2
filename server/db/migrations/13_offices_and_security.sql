-- One-time codes live in the database (hashed), so they survive restarts and work across servers
CREATE TABLE IF NOT EXISTS one_time_codes (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose      VARCHAR(30) NOT NULL,
    document_id  INTEGER,
    code_hash    CHAR(64) NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, purpose)
);

-- Offices (Registrar, Library, Finance...): a head and officers who share one queue
CREATE TABLE IF NOT EXISTS offices (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(120) NOT NULL UNIQUE,
    description  TEXT,
    head_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS office_members (
    office_id    INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (office_id, user_id)
);

-- Which office a document is waiting in (current_assignee_id is set once an officer claims it)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_office_id INTEGER REFERENCES offices(id) ON DELETE SET NULL;
