-- Add cryptographic signature columns to document_attachments table
ALTER TABLE document_attachments
  ADD COLUMN IF NOT EXISTS file_hash VARCHAR(256),
  ADD COLUMN IF NOT EXISTS attachment_signature VARCHAR(512);
