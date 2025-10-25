# Access Logging System

This document describes the access logging system implemented for the chat interface application.

## Overview

The access logging system tracks user authentication events (login/logout) and stores them for analysis and auditing purposes. It supports both file-based and database storage options.

## Features

- **User Authentication Tracking**: Logs login and logout events
- **Client Information**: Captures IP address, user agent, and session details
- **Flexible Storage**: Supports both file-based (JSON Lines) and SQLite database storage
- **Admin Dashboard**: Web interface for viewing access logs and statistics
- **Automatic Cleanup**: File rotation and old log cleanup
- **Query Interface**: API endpoints for retrieving logs and statistics

## Storage Options

### 1. File-based Logging (Default)
- **Format**: JSON Lines (.jsonl)
- **Location**: `./logs/access-YYYY-MM-DD.jsonl`
- **Rotation**: Automatic when files exceed 10MB
- **Cleanup**: Keeps last 5 files by default

### 2. Database Logging (Recommended for Production)
- **Database**: SQLite
- **Location**: `./logs/access.db`
- **Benefits**: Better querying, indexing, and analytics
- **Schema**: Structured table with proper indexing

## Configuration

### Environment Variables

```bash
# Logging type: 'file' or 'database'
LOGGER_TYPE=database

# File-based logging options
LOG_DIR=./logs
MAX_FILE_SIZE=10485760  # 10MB in bytes
MAX_FILES=5

# Database options
DB_PATH=./logs/access.db
```

### Default Configuration

If no environment variables are set, the system defaults to:
- File-based logging
- Log directory: `./logs`
- Max file size: 10MB
- Max files: 5
- Console logging: enabled in development

## Log Entry Format

Each access log entry contains:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "userId": "user@kyocare.com",
  "email": "user@kyocare.com",
  "eventType": "login",
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "sessionId": "sess_abc123",
  "metadata": {
    "domain": "kyocare.com",
    "isProduction": true
  }
}
```

## API Endpoints

### Authentication Required
All admin endpoints require authentication.

### Get User Access Logs
```
GET /api/admin/access-logs/:userId?startDate=2024-01-01&endDate=2024-01-31
```

**Response:**
```json
{
  "success": true,
  "userId": "user@kyocare.com",
  "logs": [...],
  "count": 25
}
```

### Get Access Statistics
```
GET /api/admin/access-stats?startDate=2024-01-01&endDate=2024-01-31
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalLogins": 150,
    "uniqueUsers": 25,
    "hourlyDistribution": {...},
    "dailyDistribution": {...},
    "eventTypeDistribution": {...}
  }
}
```

## Admin Dashboard

Access the admin dashboard at `/admin` (requires authentication).

### Features:
- **Statistics Overview**: Total logins, unique users, active days
- **Date Range Filtering**: Filter logs by date range
- **User-specific Logs**: View logs for specific users
- **Real-time Data**: Live statistics and log viewing

## Implementation Details

### File-based Logging
- Uses JSON Lines format for easy parsing
- Automatic file rotation based on size
- Daily log files for better organization
- Automatic cleanup of old files

### Database Logging
- SQLite database for better performance
- Structured schema with proper indexing
- Support for complex queries
- Better analytics capabilities

### Log Rotation
- **File-based**: Rotates when file exceeds max size
- **Database**: No rotation needed (handled by cleanup)
- **Cleanup**: Removes old entries based on retention policy

## Security Considerations

1. **Access Control**: Admin endpoints require authentication
2. **Data Privacy**: Logs contain sensitive information (IP addresses, user agents)
3. **Retention**: Implement appropriate data retention policies
4. **Encryption**: Consider encrypting log files in production
5. **Access Logs**: Monitor who accesses the admin dashboard

## Monitoring and Maintenance

### Regular Tasks
1. **Monitor Log Size**: Ensure adequate disk space
2. **Review Access Patterns**: Look for unusual activity
3. **Clean Old Logs**: Implement automated cleanup
4. **Backup Logs**: Regular backup of log data

### Health Checks
- Monitor log file creation
- Check database connectivity (if using database logging)
- Verify admin dashboard accessibility

## Troubleshooting

### Common Issues

1. **Log Directory Not Created**
   - Ensure write permissions for the application
   - Check if the directory path is correct

2. **Database Connection Issues**
   - Verify SQLite installation
   - Check database file permissions
   - Ensure adequate disk space

3. **Admin Dashboard Not Loading**
   - Verify authentication is working
   - Check API endpoint accessibility
   - Review browser console for errors

### Debug Mode
Enable console logging by setting `NODE_ENV` to development or setting the appropriate environment variable.

## Migration

### From File to Database
1. Set `LOGGER_TYPE=database` in environment
2. Restart the application
3. Old file logs remain accessible
4. New logs will be stored in database

### From Database to File
1. Set `LOGGER_TYPE=file` in environment
2. Restart the application
3. Database remains for historical data
4. New logs will be stored in files

## Performance Considerations

### File-based Logging
- **Pros**: Simple, no database overhead
- **Cons**: Limited querying capabilities, file I/O overhead

### Database Logging
- **Pros**: Better querying, indexing, analytics
- **Cons**: Database overhead, more complex setup

### Recommendations
- **Development**: Use file-based logging
- **Production**: Use database logging
- **High Volume**: Consider database with proper indexing
- **Analytics**: Database logging is essential

## Future Enhancements

1. **Real-time Dashboard**: WebSocket updates for live monitoring
2. **Advanced Analytics**: More sophisticated reporting
3. **Alerting**: Notifications for unusual access patterns
4. **Export**: CSV/Excel export functionality
5. **Integration**: Connect with external monitoring tools

