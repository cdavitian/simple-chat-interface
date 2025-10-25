#!/usr/bin/env node

// Test script to verify PostgreSQL connection
require('dotenv').config();
const PostgreSQLAccessLogger = require('./postgresql-logger');

async function testConnection() {
    console.log('🧪 Testing PostgreSQL connection...');
    console.log('Environment variables:');
    console.log('- DB_HOST:', process.env.DB_HOST);
    console.log('- DB_PORT:', process.env.DB_PORT);
    console.log('- DB_NAME:', process.env.DB_NAME);
    console.log('- DB_USER:', process.env.DB_USER);
    console.log('- DB_SSL:', process.env.DB_SSL);
    console.log('- DB_PASSWORD:', process.env.DB_PASSWORD ? 'SET' : 'NOT SET');
    
    try {
        const logger = new PostgreSQLAccessLogger({
            enableConsole: true
        });
        
        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('✅ PostgreSQL connection test completed successfully!');
        
        // Test logging an event
        console.log('📝 Testing access logging...');
        await logger.logAccess({
            userId: 'test-user',
            email: 'test@example.com',
            eventType: 'test',
            ipAddress: '127.0.0.1',
            userAgent: 'test-agent',
            sessionId: 'test-session',
            metadata: { test: true }
        });
        
        console.log('✅ Access logging test completed successfully!');
        
        // Close the connection
        await logger.close();
        console.log('🔌 Database connection closed');
        
    } catch (error) {
        console.error('❌ PostgreSQL connection test failed:');
        console.error('Error:', error.message);
        console.error('Code:', error.code);
        console.error('Detail:', error.detail);
        process.exit(1);
    }
}

testConnection();
