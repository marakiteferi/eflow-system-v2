CREATE TABLE IF NOT EXISTS document_tags_history (
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  tag_name VARCHAR(100) NOT NULL,
  tag_value VARCHAR(255),
  applied_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  node_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);