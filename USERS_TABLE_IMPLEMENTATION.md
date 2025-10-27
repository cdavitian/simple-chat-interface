# Users Table Implementation

This document describes the implementation of the users table that automatically maintains user information based on access logs.

## Overview

The users table stores consolidated user information derived from the access_logs table. It is automatically maintained every time a user logs in, ensuring the most up-to-date user information is always available.

## Table Structure

The users table contains the following columns:

- `user_id` (VARCHAR(255), PRIMARY KEY) - Unique user identifier
- `created` (TIMESTAMP(3), NOT NULL) - Timestamp of first login
- `last_login` (TIMESTAMP(3), NOT NULL) - Timestamp of most recent login
- `email` (VARCHAR(255), NOT NULL) - User's email address
- `family_name` (VARCHAR(255), NULL) - User's family name from Google OAuth
- `given_name` (VARCHAR(255), NULL) - User's given name from Google OAuth
- `full_name` (VARCHAR(255), NULL) - User's full name from Google OAuth
- `user_type` (VARCHAR(50), DEFAULT 'New') - User type (defaults to 'New')
- `created_at` (TIMESTAMP(3), NOT NULL) - Record creation timestamp
- `updated_at` (TIMESTAMP(3), NOT NULL) - Record last update timestamp

## Automatic Maintenance

The users table is automatically maintained through the following mechanisms:

### 1. Login Event Processing

Every time a user logs in (event_type = 'login'), the system:

1. **Creates the users table** if it doesn't exist
2. **Inserts a new user record** if the user doesn't exist
3. **Updates existing user record** if the user already exists with:
   - Updated `last_login` timestamp
   - Updated user information (email, names) from the current login
   - Updated `updated_at` timestamp

### 2. First Login Detection

For new users, the `created` timestamp is automatically set to their first login by querying the access_logs table for the earliest login event.

## Files Created/Modified

### New Files

1. **`database/migrate-create-users-table.sql`** - SQL migration script to create the users table
2. **`migrate-users-table.js`** - Node.js script to run the migration and populate initial data
3. **`test-users-table-simple.js`** - Test script to verify implementation
4. **`USERS_TABLE_IMPLEMENTATION.md`** - This documentation file

### Modified Files

1. **`postgresql-logger.js`** - Updated to maintain users table on login events
   - Added `updateUsersTable()` method
   - Added `ensureUsersTableExists()` method
   - Modified `logAccess()` to call users table update for login events
   - Updated `getAllUsers()` to query from users table instead of access_logs

## Usage

### Initial Setup

1. **Set up PostgreSQL environment variables:**
   ```bash
   DB_HOST=your_postgres_host
   DB_NAME=your_database_name
   DB_USER=your_username
   DB_PASSWORD=your_password
   DB_SSL=true
   ```

2. **Run the migration:**
   ```bash
   node migrate-users-table.js
   ```

### Automatic Operation

Once set up, the users table is automatically maintained. No additional configuration is required.

### Querying Users

Use the existing API endpoints:

- `GET /api/admin/users` - Get all users with filtering options
- `GET /api/debug-admin-users` - Debug endpoint for user data

## Data Flow

```
User Login Event
       ↓
logAccess() called
       ↓
Insert into access_logs
       ↓
If event_type = 'login'
       ↓
updateUsersTable()
       ↓
Insert/Update users table
       ↓
Set created = first login timestamp
```

## Benefits

1. **Performance** - Fast user queries without aggregating access_logs
2. **Consistency** - Always up-to-date user information
3. **Simplicity** - Single source of truth for user data
4. **Automatic** - No manual maintenance required
5. **Reliable** - Handles both new and existing users correctly

## Testing

Run the test script to verify the implementation:

```bash
node test-users-table-simple.js
```

This will verify:
- Migration SQL syntax
- Migration script structure
- PostgreSQL logger updates
- File existence and readability

## Notes

- The users table is only created and maintained when using PostgreSQL logging
- File-based logging does not support the users table
- All existing functionality continues to work unchanged
- The implementation is backward compatible
