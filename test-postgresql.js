// Test script for PostgreSQL database configuration
require('dotenv').config();
const PostgreSQLAccessLogger = require('./postgresql-logger');

async function testPostgreSQL() {
    console.log('🧪 Testing PostgreSQL Database Configuration');
    console.log('============================================');
    
    const logger = new PostgreSQLAccessLogger({
        enableConsole: true
    });

    try {
        // Wait a moment for database initialization
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test logging an access event
        console.log('📝 Testing access logging...');
        await logger.logAccess({
            userId: 'test@kyocare.com',
            email: 'test@kyocare.com',
            eventType: 'login',
            ipAddress: '192.168.1.100',
            userAgent: 'Test User Agent',
            sessionId: 'test-session-123',
            metadata: { test: true, domain: 'kyocare.com' }
        });
        console.log('✅ Access logging test passed');

        // Test querying logs
        console.log('🔍 Testing log queries...');
        const logs = await logger.queryUserLogs('test@kyocare.com');
        console.log(`✅ Query test passed, found ${logs.length} entries`);

        // Test access statistics
        console.log('📊 Testing access statistics...');
        const stats = await logger.getAccessStats();
        console.log('✅ Statistics test passed');
        console.log('📈 Stats:', {
            totalLogins: stats.totalLogins,
            uniqueUsers: stats.uniqueUsers,
            eventTypes: Object.keys(stats.eventTypeDistribution)
        });

        // Test recent logins
        console.log('🕒 Testing recent logins...');
        const recentLogins = await logger.getRecentLogins(5);
        console.log(`✅ Recent logins test passed, found ${recentLogins.length} entries`);

        console.log('\n🎉 All tests passed! PostgreSQL configuration is working correctly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        // Close the database connection
        await logger.close();
        console.log('🔒 Database connection closed');
    }
}

// Run the test
testPostgreSQL();
