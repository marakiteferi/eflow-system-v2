-- Add signature_data column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_data TEXT;
