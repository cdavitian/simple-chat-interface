// Test script to verify PostgreSQL table creation
require('dotenv').config();
const { Pool } = require('pg');

async function testTableCreation() {
    console.log('🧪 Testing PostgreSQL Table Creation');
    console.log('====================================');
    
    // Create a test connection
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true'
    });

    try {
        console.log('🔌 Connecting to PostgreSQL...');
        
        // Test connection
        const client = await pool.connect();
        console.log('✅ Connected to PostgreSQL successfully');
        
        // Check if table exists before creation
        console.log('🔍 Checking if access_logs table exists...');
        const checkTableQuery = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'access_logs'
            );
        `;
        
        const tableExists = await client.query(checkTableQuery);
        console.log(`📊 Table exists before creation: ${tableExists.rows[0].exists}`);
        
        // Create the table (this is what happens in your app)
        console.log('🏗️  Creating access_logs table...');
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS access_logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_id VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                ip_address INET,
                user_agent TEXT,
                session_id VARCHAR(255),
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        await client.query(createTableSQL);
        console.log('✅ Table created successfully');
        
        // Check if table exists after creation
        const tableExistsAfter = await client.query(checkTableQuery);
        console.log(`📊 Table exists after creation: ${tableExistsAfter.rows[0].exists}`);
        
        // Test inserting a record
        console.log('📝 Testing record insertion...');
        const insertSQL = `
            INSERT INTO access_logs 
            (user_id, email, event_type, ip_address, user_agent, session_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        
        const values = [
            'test@kyocare.com',
            'test@kyocare.com',
            'login',
            '192.168.1.100',
            'Test User Agent',
            'test-session-123',
            JSON.stringify({ test: true })
        ];
        
        await client.query(insertSQL, values);
        console.log('✅ Record inserted successfully');
        
        // Test querying the record
        console.log('🔍 Testing record query...');
        const selectSQL = 'SELECT * FROM access_logs WHERE user_id = $1';
        const result = await client.query(selectSQL, ['test@kyocare.com']);
        console.log(`✅ Query successful, found ${result.rows.length} records`);
        
        console.log('\n🎉 All tests passed! Table creation and operations work correctly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await pool.end();
        console.log('🔒 Database connection closed');
    }
}

// Run the test
testTableCreation();
