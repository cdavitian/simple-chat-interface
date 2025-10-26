-- AWS Aurora Database Schema for Access Logging
-- Supports both MySQL and PostgreSQL Aurora clusters

-- Create database (run this first if creating a new database)
-- CREATE DATABASE access_logs;

-- Use the database
-- USE access_logs;

-- Create access_logs table
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45), -- IPv6 addresses can be up to 45 characters
    user_agent TEXT,
    session_id VARCHAR(255),
    metadata JSON,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    
    -- Google OAuth attributes from Cognito
    email_verified BOOLEAN DEFAULT NULL,
    family_name VARCHAR(255) DEFAULT NULL,
    given_name VARCHAR(255) DEFAULT NULL,
    full_name VARCHAR(255) DEFAULT NULL,
    picture_url VARCHAR(500) DEFAULT NULL,
    username VARCHAR(255) DEFAULT NULL,
    
    -- Indexes for better query performance
    INDEX idx_user_id (user_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_event_type (event_type),
    INDEX idx_user_timestamp (user_id, timestamp),
    INDEX idx_created_at (created_at),
    INDEX idx_email_verified (email_verified),
    INDEX idx_username (username)
);

-- Create a view for login events only (useful for analytics)
CREATE OR REPLACE VIEW login_events AS
SELECT 
    id,
    timestamp,
    user_id,
    email,
    ip_address,
    user_agent,
    session_id,
    metadata,
    created_at
FROM access_logs 
WHERE event_type = 'login';

-- Create a view for daily statistics
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_events,
    COUNT(DISTINCT user_id) as unique_users,
    SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as logins,
    SUM(CASE WHEN event_type = 'logout' THEN 1 ELSE 0 END) as logouts
FROM access_logs 
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Create a view for hourly distribution
CREATE OR REPLACE VIEW hourly_stats AS
SELECT 
    DATE(timestamp) as date,
    HOUR(timestamp) as hour,
    COUNT(*) as total_events,
    COUNT(DISTINCT user_id) as unique_users,
    SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as logins
FROM access_logs 
GROUP BY DATE(timestamp), HOUR(timestamp)
ORDER BY date DESC, hour DESC;

-- Create a view for user activity summary
CREATE OR REPLACE VIEW user_activity_summary AS
SELECT 
    user_id,
    email,
    COUNT(*) as total_events,
    SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as login_count,
    SUM(CASE WHEN event_type = 'logout' THEN 1 ELSE 0 END) as logout_count,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen,
    COUNT(DISTINCT DATE(timestamp)) as active_days
FROM access_logs 
GROUP BY user_id, email
ORDER BY last_seen DESC;

-- Create a stored procedure for cleanup (MySQL)
DELIMITER //
CREATE PROCEDURE CleanupOldLogs(IN days_to_keep INT)
BEGIN
    DECLARE cutoff_date DATETIME;
    SET cutoff_date = DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    DELETE FROM access_logs 
    WHERE timestamp < cutoff_date;
    
    SELECT ROW_COUNT() as deleted_rows;
END //
DELIMITER ;

-- Create a function to get user login count (MySQL)
DELIMITER //
CREATE FUNCTION GetUserLoginCount(user_email VARCHAR(255), start_date DATETIME, end_date DATETIME)
RETURNS INT
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE login_count INT DEFAULT 0;
    
    SELECT COUNT(*) INTO login_count
    FROM access_logs 
    WHERE email = user_email 
    AND event_type = 'login'
    AND timestamp BETWEEN start_date AND end_date;
    
    RETURN login_count;
END //
DELIMITER ;

-- Insert sample data for testing (optional)
-- INSERT INTO access_logs (user_id, email, event_type, ip_address, user_agent, session_id, metadata) VALUES
-- ('test@kyocare.com', 'test@kyocare.com', 'login', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'sess_123', '{"domain": "kyocare.com", "isProduction": true}'),
-- ('test@kyocare.com', 'test@kyocare.com', 'logout', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'sess_123', '{}');

