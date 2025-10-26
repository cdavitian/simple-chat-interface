const LoggingConfig = require('./logging-config');
require('dotenv').config();

async function migrateUsersTable() {
    const loggingConfig = new LoggingConfig();
    
    try {
        console.log('Starting users table migration...');
        
        // Read and execute the migration SQL
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(path.join(__dirname, 'database', 'migrate-create-users-table.sql'), 'utf8');
        
        console.log('Creating users table...');
        await loggingConfig.logger.pool.query(migrationSQL);
        console.log('✅ Users table created successfully');
        
        // Populate users table from access_logs
        console.log('Populating users table from access_logs...');
        
        const populateSQL = `
            INSERT INTO users (user_id, created, last_login, email, family_name, given_name, full_name, user_type)
            SELECT DISTINCT ON (al.user_id)
                al.user_id,
                MIN(al.timestamp) as created,
                MAX(al.timestamp) as last_login,
                al.email,
                al.family_name,
                al.given_name,
                al.full_name,
                'new' as user_type
            FROM access_logs al
            WHERE al.event_type = 'login'
            GROUP BY al.user_id, al.email, al.family_name, al.given_name, al.full_name
            ON CONFLICT (user_id) DO UPDATE SET
                last_login = EXCLUDED.last_login,
                email = EXCLUDED.email,
                family_name = EXCLUDED.family_name,
                given_name = EXCLUDED.given_name,
                full_name = EXCLUDED.full_name,
                updated_at = CURRENT_TIMESTAMP
        `;
        
        const result = await loggingConfig.logger.pool.query(populateSQL);
        console.log(`✅ Users table populated with ${result.rowCount} users`);
        
        // Verify the migration
        const verifySQL = `
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN user_type = 'new' THEN 1 END) as new_users,
                MIN(created) as earliest_user,
                MAX(last_login) as latest_login
            FROM users
        `;
        
        const verifyResult = await loggingConfig.logger.pool.query(verifySQL);
        console.log('Migration verification:', verifyResult.rows[0]);
        
        console.log('✅ Users table migration completed successfully');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await loggingConfig.logger.pool.end();
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateUsersTable()
        .then(() => {
            console.log('Migration completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = migrateUsersTable;
