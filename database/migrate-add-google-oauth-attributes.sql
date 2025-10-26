-- Migration script to add Google OAuth attributes to access_logs table
-- Run this script to add the new columns to existing databases

-- For MySQL/Aurora MySQL
-- ALTER TABLE access_logs 
-- ADD COLUMN email_verified BOOLEAN DEFAULT NULL AFTER metadata,
-- ADD COLUMN family_name VARCHAR(255) DEFAULT NULL AFTER email_verified,
-- ADD COLUMN given_name VARCHAR(255) DEFAULT NULL AFTER family_name,
-- ADD COLUMN full_name VARCHAR(255) DEFAULT NULL AFTER given_name,
-- ADD COLUMN picture_url VARCHAR(500) DEFAULT NULL AFTER full_name,
-- ADD COLUMN username VARCHAR(255) DEFAULT NULL AFTER picture_url;

-- For PostgreSQL/Aurora PostgreSQL
ALTER TABLE access_logs 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS family_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS given_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS picture_url VARCHAR(500) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT NULL;

-- Add indexes for the new columns (PostgreSQL)
CREATE INDEX IF NOT EXISTS idx_access_logs_email_verified ON access_logs(email_verified);
CREATE INDEX IF NOT EXISTS idx_access_logs_username ON access_logs(username);

-- For MySQL, add these indexes:
-- CREATE INDEX idx_email_verified ON access_logs(email_verified);
-- CREATE INDEX idx_username ON access_logs(username);
