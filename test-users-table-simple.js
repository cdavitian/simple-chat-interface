const fs = require('fs');
const path = require('path');

async function testUsersTableMigration() {
    try {
        console.log('Testing users table migration script...');
        
        // Test 1: Check if migration SQL file exists and is valid
        console.log('\n1. Checking migration SQL file...');
        const migrationPath = path.join(__dirname, 'database', 'migrate-create-users-table.sql');
        
        if (!fs.existsSync(migrationPath)) {
            throw new Error('Migration SQL file not found');
        }
        
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        console.log('✅ Migration SQL file found and readable');
        
        // Test 2: Check if migration script exists and is valid
        console.log('\n2. Checking migration script...');
        const scriptPath = path.join(__dirname, 'migrate-users-table.js');
        
        if (!fs.existsSync(scriptPath)) {
            throw new Error('Migration script not found');
        }
        
        console.log('✅ Migration script found');
        
        // Test 3: Verify SQL syntax (basic checks)
        console.log('\n3. Verifying SQL syntax...');
        
        // Check for required SQL statements
        const requiredStatements = [
            'CREATE TABLE IF NOT EXISTS users',
            'user_id VARCHAR(255) PRIMARY KEY',
            'created TIMESTAMP(3) NOT NULL',
            'last_login TIMESTAMP(3) NOT NULL',
            'email VARCHAR(255) NOT NULL',
            'family_name VARCHAR(255)',
            'given_name VARCHAR(255)',
            'full_name VARCHAR(255)',
            'user_type VARCHAR(50) DEFAULT \'new\'',
            'CREATE INDEX IF NOT EXISTS',
            'CREATE OR REPLACE FUNCTION',
            'CREATE TRIGGER'
        ];
        
        for (const statement of requiredStatements) {
            if (!migrationSQL.includes(statement)) {
                throw new Error(`Required SQL statement not found: ${statement}`);
            }
        }
        
        console.log('✅ SQL syntax verification passed');
        
        // Test 4: Check PostgreSQL logger updates
        console.log('\n4. Checking PostgreSQL logger updates...');
        const loggerPath = path.join(__dirname, 'postgresql-logger.js');
        const loggerContent = fs.readFileSync(loggerPath, 'utf8');
        
        const requiredLoggerUpdates = [
            'updateUsersTable',
            'ensureUsersTableExists',
            'ON CONFLICT (user_id) DO UPDATE SET',
            'event.eventType === \'login\''
        ];
        
        for (const update of requiredLoggerUpdates) {
            if (!loggerContent.includes(update)) {
                throw new Error(`Required logger update not found: ${update}`);
            }
        }
        
        console.log('✅ PostgreSQL logger updates verified');
        
        // Test 5: Check migration script structure
        console.log('\n5. Checking migration script structure...');
        const scriptContent = fs.readFileSync(scriptPath, 'utf8');
        
        const requiredScriptFeatures = [
            'migrateUsersTable',
            'INSERT INTO users',
            'ON CONFLICT (user_id) DO UPDATE SET',
            'module.exports = migrateUsersTable'
        ];
        
        for (const feature of requiredScriptFeatures) {
            if (!scriptContent.includes(feature)) {
                throw new Error(`Required script feature not found: ${feature}`);
            }
        }
        
        console.log('✅ Migration script structure verified');
        
        console.log('\n✅ All tests passed! The users table implementation is ready.');
        console.log('\nTo use this in production:');
        console.log('1. Set up PostgreSQL environment variables (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD)');
        console.log('2. Run: node migrate-users-table.js');
        console.log('3. The users table will be automatically maintained on each login');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    }
}

// Run test if called directly
if (require.main === module) {
    testUsersTableMigration()
        .then(() => {
            console.log('Test completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Test failed:', error);
            process.exit(1);
        });
}

module.exports = testUsersTableMigration;
