/**
 * Setup script to create test users with different permission levels
 * This script creates test users for testing the permission system
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

async function setupTestUsers() {
    try {
        console.log('🔧 Setting up test users...\n');
        
        // Test users with different permission levels
        const testUsers = [
            {
                email: 'admin@kyocare.com',
                name: 'Admin User',
                userType: 'Admin',
                description: 'Full access to all features'
            },
            {
                email: 'standard@kyocare.com',
                name: 'Standard User',
                userType: 'Standard',
                description: 'Access to chat but no admin features'
            },
            {
                email: 'newuser@kyocare.com',
                name: 'New User',
                userType: 'New',
                description: 'Restricted access - only sees restricted page'
            }
        ];
        
        for (const user of testUsers) {
            console.log(`Setting up ${user.name} (${user.email})...`);
            
            // Check if user already exists
            const existingUser = await pool.query(`
                SELECT user_id, user_type FROM users WHERE email = $1
            `, [user.email]);
            
            if (existingUser.rows.length > 0) {
                // Update existing user
                await pool.query(`
                    UPDATE users 
                    SET user_type = $1, 
                        full_name = $2,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE email = $3
                `, [user.userType, user.name, user.email]);
                console.log(`   ✅ Updated existing user: ${user.userType}`);
            } else {
                // Create new user
                const userId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                await pool.query(`
                    INSERT INTO users (user_id, email, full_name, user_type, created, last_login, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [userId, user.email, user.name, user.userType]);
                console.log(`   ✅ Created new user: ${user.userType}`);
            }
            
            console.log(`   📝 ${user.description}`);
        }
        
        console.log('\n📊 Test users summary:');
        const allUsers = await pool.query(`
            SELECT email, full_name, user_type, created_at
            FROM users 
            WHERE email LIKE '%@kyocare.com'
            ORDER BY user_type, email
        `);
        
        allUsers.rows.forEach(user => {
            console.log(`   - ${user.email} (${user.full_name}): ${user.user_type}`);
        });
        
        console.log('\n🎉 Test users setup completed!');
        console.log('\nYou can now test the permission system by:');
        console.log('1. Logging in as admin@kyocare.com - should see full access');
        console.log('2. Logging in as standard@kyocare.com - should see chat but no admin button');
        console.log('3. Logging in as newuser@kyocare.com - should see restricted page only');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        console.error('Error details:', error);
    } finally {
        await pool.end();
    }
}

// Run the setup
setupTestUsers();

