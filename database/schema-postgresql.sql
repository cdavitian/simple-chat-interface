-- AWS Aurora PostgreSQL Database Schema for Access Logging
-- Alternative schema for PostgreSQL Aurora clusters

-- Create database (run this first if creating a new database)
-- CREATE DATABASE access_logs;

-- Create access_logs table
CREATE TABLE IF NOT EXISTS access_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    ip_address INET, -- PostgreSQL INET type for IP addresses
    user_agent TEXT,
    session_id VARCHAR(255),
    metadata JSONB, -- PostgreSQL JSONB for better JSON performance
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_logs_event_type ON access_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_timestamp ON access_logs(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);

-- Create a GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS idx_access_logs_metadata ON access_logs USING GIN(metadata);

-- Create a view for login events only
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
    EXTRACT(HOUR FROM timestamp) as hour,
    COUNT(*) as total_events,
    COUNT(DISTINCT user_id) as unique_users,
    SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as logins
FROM access_logs 
GROUP BY DATE(timestamp), EXTRACT(HOUR FROM timestamp)
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

-- Create a function for cleanup
CREATE OR REPLACE FUNCTION cleanup_old_logs(days_to_keep INTEGER)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
    cutoff_date TIMESTAMP;
BEGIN
    cutoff_date := CURRENT_TIMESTAMP - INTERVAL '1 day' * days_to_keep;
    
    DELETE FROM access_logs 
    WHERE timestamp < cutoff_date;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get user login count
CREATE OR REPLACE FUNCTION get_user_login_count(
    user_email VARCHAR(255), 
    start_date TIMESTAMP, 
    end_date TIMESTAMP
)
RETURNS INTEGER AS $$
DECLARE
    login_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO login_count
    FROM access_logs 
    WHERE email = user_email 
    AND event_type = 'login'
    AND timestamp BETWEEN start_date AND end_date;
    
    RETURN login_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get access statistics
CREATE OR REPLACE FUNCTION get_access_statistics(
    start_date TIMESTAMP DEFAULT NULL,
    end_date TIMESTAMP DEFAULT NULL
)
RETURNS TABLE(
    total_logins BIGINT,
    unique_users BIGINT,
    total_events BIGINT,
    login_rate NUMERIC
) AS $$
DECLARE
    start_ts TIMESTAMP;
    end_ts TIMESTAMP;
BEGIN
    start_ts := COALESCE(start_date, CURRENT_TIMESTAMP - INTERVAL '30 days');
    end_ts := COALESCE(end_date, CURRENT_TIMESTAMP);
    
    RETURN QUERY
    SELECT 
        COUNT(CASE WHEN event_type = 'login' THEN 1 END) as total_logins,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(*) as total_events,
        ROUND(
            COUNT(CASE WHEN event_type = 'login' THEN 1 END)::NUMERIC / 
            NULLIF(COUNT(*), 0) * 100, 2
        ) as login_rate
    FROM access_logs 
    WHERE timestamp BETWEEN start_ts AND end_ts;
END;
$$ LANGUAGE plpgsql;

-- Insert sample data for testing (optional)
-- INSERT INTO access_logs (user_id, email, event_type, ip_address, user_agent, session_id, metadata) VALUES
-- ('test@kyocare.com', 'test@kyocare.com', 'login', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'sess_123', '{"domain": "kyocare.com", "isProduction": true}'),
-- ('test@kyocare.com', 'test@kyocare.com', 'logout', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'sess_123', '{}');

