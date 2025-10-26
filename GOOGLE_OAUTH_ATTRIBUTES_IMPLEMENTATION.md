# Google OAuth Attributes Implementation

This document describes the implementation of Google OAuth attribute capture and storage in the access_logs table.

## Overview

The system now captures and stores additional Google OAuth attributes from AWS Cognito when users log in via Google OAuth. These attributes are stored as separate columns in the `access_logs` table for better querying and analytics.

## Captured Attributes

Based on the Cognito attribute mapping configuration, the following Google OAuth attributes are now captured:

| User Pool Attribute | Google Attribute | Database Column | Type | Description |
|-------------------|------------------|-----------------|------|-------------|
| email | email | email | VARCHAR(255) | User's email address |
| email_verified | email_verified | email_verified | BOOLEAN | Whether email is verified |
| family_name | family_name | family_name | VARCHAR(255) | User's last name |
| given_name | given_name | given_name | VARCHAR(255) | User's first name |
| name | name | full_name | VARCHAR(255) | User's full name |
| picture | picture | picture_url | VARCHAR(500) | User's profile picture URL |
| username | sub | username | VARCHAR(255) | Username (mapped from Google sub) |

## Database Schema Changes

### New Columns Added

The following columns have been added to the `access_logs` table:

```sql
-- Google OAuth attributes from Cognito
email_verified BOOLEAN DEFAULT NULL,
family_name VARCHAR(255) DEFAULT NULL,
given_name VARCHAR(255) DEFAULT NULL,
full_name VARCHAR(255) DEFAULT NULL,
picture_url VARCHAR(500) DEFAULT NULL,
username VARCHAR(255) DEFAULT NULL
```

### Indexes Added

For better query performance, the following indexes have been added:

```sql
CREATE INDEX idx_access_logs_email_verified ON access_logs(email_verified);
CREATE INDEX idx_access_logs_username ON access_logs(username);
```

## Implementation Details

### 1. Database Schema Updates

- **MySQL/Aurora MySQL**: Updated `database/schema.sql`
- **PostgreSQL/Aurora PostgreSQL**: Updated `database/schema-postgresql.sql`
- **Migration Script**: Created `database/migrate-add-google-oauth-attributes.sql`

### 2. Server-Side Changes

#### Session Storage
The user session now includes additional Google OAuth attributes:

```javascript
req.session.user = {
    id: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name,
    avatar: userInfo.picture,
    // Additional Google OAuth attributes
    emailVerified: userInfo.email_verified,
    familyName: userInfo.family_name,
    givenName: userInfo.given_name,
    username: userInfo.sub
};
```

#### Access Logging
The `logAccess` call now includes Google OAuth attributes:

```javascript
await loggingConfig.logAccess({
    userId: req.session.user.id,
    email: req.session.user.email,
    eventType: 'login',
    ipAddress: clientInfo.ipAddress,
    userAgent: clientInfo.userAgent,
    sessionId: req.sessionID,
    // Google OAuth attributes from Cognito
    emailVerified: userInfo.email_verified,
    familyName: userInfo.family_name,
    givenName: userInfo.given_name,
    fullName: userInfo.name,
    pictureUrl: userInfo.picture,
    username: userInfo.sub,
    metadata: {
        authMethod: 'cognito_google_oauth',
        domain: domain,
        isProduction: isProduction
    }
});
```

### 3. Logger Updates

#### PostgreSQL Logger
Updated `postgresql-logger.js` to handle the new attributes:

- Modified `logAccess()` method to insert Google OAuth attributes
- Updated `createTables()` method to include new columns
- Added index creation for new columns

## Migration Instructions

### For Existing Databases

1. **Run the migration script**:
   ```bash
   node migrate-google-oauth-attributes.js
   ```

2. **Or manually run the SQL migration**:
   ```bash
   psql -h your-host -U your-user -d your-database -f database/migrate-add-google-oauth-attributes.sql
   ```

### For New Databases

The updated schema files will automatically create the new columns when the database is initialized.

## Testing

### Test Script

Run the test script to verify the implementation:

```bash
node test-google-oauth-attributes.js
```

This script will:
1. Simulate a Google OAuth login with mock data
2. Log the access event with Google OAuth attributes
3. Query the logged event to verify all attributes are stored
4. Display verification results

### Manual Testing

1. **Login via Google OAuth** and check the logs
2. **Query the database** to verify attributes are stored:
   ```sql
   SELECT user_id, email, email_verified, family_name, given_name, full_name, picture_url, username
   FROM access_logs 
   WHERE event_type = 'login' 
   AND auth_method = 'cognito_google_oauth'
   ORDER BY timestamp DESC 
   LIMIT 10;
   ```

## Query Examples

### Get Users by Email Verification Status
```sql
SELECT user_id, email, email_verified, full_name
FROM access_logs 
WHERE email_verified = true
AND event_type = 'login';
```

### Get Users by Name Components
```sql
SELECT user_id, email, given_name, family_name, full_name
FROM access_logs 
WHERE given_name IS NOT NULL 
AND family_name IS NOT NULL
AND event_type = 'login';
```

### Get Users with Profile Pictures
```sql
SELECT user_id, email, full_name, picture_url
FROM access_logs 
WHERE picture_url IS NOT NULL
AND event_type = 'login';
```

### Analytics Queries
```sql
-- Count verified vs unverified email logins
SELECT 
    email_verified,
    COUNT(*) as login_count
FROM access_logs 
WHERE event_type = 'login'
GROUP BY email_verified;

-- Most common first names
SELECT 
    given_name,
    COUNT(*) as frequency
FROM access_logs 
WHERE given_name IS NOT NULL
AND event_type = 'login'
GROUP BY given_name
ORDER BY frequency DESC
LIMIT 10;
```

## Benefits

1. **Enhanced User Analytics**: Track user demographics and verification status
2. **Better User Management**: Access to detailed user profile information
3. **Improved Security**: Track email verification status
4. **Rich Reporting**: Generate reports based on user attributes
5. **Audit Trail**: Complete user profile information in access logs

## Backward Compatibility

- Existing log entries will have `NULL` values for the new Google OAuth attributes
- The system gracefully handles missing attributes
- No breaking changes to existing functionality
- All new attributes are optional (nullable)

## Monitoring

Monitor the following to ensure the implementation is working correctly:

1. **Log Entries**: Check that new log entries include Google OAuth attributes
2. **Database Performance**: Monitor query performance with new indexes
3. **Error Logs**: Watch for any errors in attribute capture or storage
4. **Migration Status**: Verify migration completed successfully

## Troubleshooting

### Common Issues

1. **Missing Attributes**: Ensure Cognito attribute mapping is configured correctly
2. **Migration Errors**: Check database permissions and connection
3. **Null Values**: Verify Google OAuth scopes include required attributes
4. **Performance Issues**: Check that indexes are created properly

### Debug Commands

```bash
# Check if migration was successful
node migrate-google-oauth-attributes.js

# Test attribute capture
node test-google-oauth-attributes.js

# Check recent logs with new attributes
curl http://localhost:3000/api/all-logs
```
