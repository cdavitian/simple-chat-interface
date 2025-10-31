/**
 * Test script to verify permission system
 * This script tests the user type checking and permission system
 */

const { Pool } = require('pg');

// Database connection (using same config as the app)
const pool = new Pool({
    host: process.env.PGHOST || process.env.DB_HOST,
    port: process.env.PGPORT || process.env.DB_PORT,
    database: process.env.PGDATABASE || process.env.DB_NAME,
    user: process.env.PGUSER || process.env.DB_USER,
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false,
        sslmode: 'require'
    } : false
});

async function testPermissions() {
    try {
        console.log('🔍 Testing Permission System...\n');
        
        // Test 1: Check if users table exists and has user_type column
        console.log('1. Checking users table structure...');
        const tableCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users' 
            AND column_name = 'user_type'
        `);
        
        if (tableCheck.rows.length > 0) {
            console.log('✅ Users table has user_type column');
        } else {
            console.log('❌ Users table missing user_type column');
            return;
        }
        
        // Test 2: Check existing users and their types
        console.log('\n2. Checking existing users...');
        const users = await pool.query(`
            SELECT email, user_type, created_at 
            FROM users 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        if (users.rows.length > 0) {
            console.log('✅ Found users in database:');
            users.rows.forEach(user => {
                console.log(`   - ${user.email}: ${user.user_type || 'No type set'}`);
            });
        } else {
            console.log('⚠️  No users found in database');
        }
        
        // Test 3: Test user type constants
        console.log('\n3. Testing user type constants...');
        const { USER_TYPE, isValidUserType } = require('./constants.js');
        
        console.log('Available user types:', Object.values(USER_TYPE));
        
        // Test validation
        const testTypes = ['Admin', 'Standard', 'New', 'Invalid'];
        testTypes.forEach(type => {
            const isValid = isValidUserType(type);
            console.log(`   - "${type}": ${isValid ? '✅ Valid' : '❌ Invalid'}`);
        });
        
        // Test 4: Check if we can update a user type
        console.log('\n4. Testing user type update...');
        if (users.rows.length > 0) {
            const testUser = users.rows[0];
            const newType = testUser.user_type === 'Admin' ? 'Standard' : 'Admin';
            
            console.log(`   Updating ${testUser.email} from ${testUser.user_type} to ${newType}...`);
            
            const updateResult = await pool.query(`
                UPDATE users 
                SET user_type = $1, updated_at = CURRENT_TIMESTAMP
                WHERE email = $2
            `, [newType, testUser.email]);
            
            if (updateResult.rowCount > 0) {
                console.log('✅ User type updated successfully');
                
                // Verify the update
                const verifyResult = await pool.query(`
                    SELECT user_type FROM users WHERE email = $1
                `, [testUser.email]);
                
                if (verifyResult.rows[0].user_type === newType) {
                    console.log('✅ User type update verified');
                } else {
                    console.log('❌ User type update verification failed');
                }
                
                // Revert the change
                await pool.query(`
                    UPDATE users 
                    SET user_type = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE email = $2
                `, [testUser.user_type, testUser.email]);
                console.log('✅ User type reverted to original value');
            } else {
                console.log('❌ Failed to update user type');
            }
        } else {
            console.log('⚠️  Skipping user type update test - no users found');
        }
        
        console.log('\n🎉 Permission system test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Error details:', error);
    } finally {
        await pool.end();
    }
}

// Run the test
testPermissions();

