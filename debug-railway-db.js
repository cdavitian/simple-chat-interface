#!/usr/bin/env node

/**
 * Railway Database Connection Debug Script
 * 
 * This script helps debug Railway PostgreSQL connection issues.
 * Run this in your Railway environment to see what's happening.
 */

require('dotenv').config();

console.log('🔍 Railway Database Connection Debug');
console.log('=====================================');

// Check environment variables
console.log('\n📋 Environment Variables:');
console.log('LOGGER_TYPE:', process.env.LOGGER_TYPE || 'NOT SET');
console.log('DB_HOST:', process.env.DB_HOST || 'NOT SET');
console.log('DB_PORT:', process.env.DB_PORT || 'NOT SET');
console.log('DB_NAME:', process.env.DB_NAME || 'NOT SET');
console.log('DB_USER:', process.env.DB_USER || 'NOT SET');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? 'SET (hidden)' : 'NOT SET');
console.log('DB_SSL:', process.env.DB_SSL || 'NOT SET');

// Check for Railway-specific variables
console.log('\n🚂 Railway PostgreSQL Variables:');
console.log('PGHOST:', process.env.PGHOST || 'NOT SET');
console.log('PGPORT:', process.env.PGPORT || 'NOT SET');
console.log('PGDATABASE:', process.env.PGDATABASE || 'NOT SET');
console.log('PGUSER:', process.env.PGUSER || 'NOT SET');
console.log('PGPASSWORD:', process.env.PGPASSWORD ? 'SET (hidden)' : 'NOT SET');

// Test connection if variables are set
if (process.env.DB_HOST && process.env.DB_NAME) {
    console.log('\n🔌 Testing Database Connection...');
    
    const { Pool } = require('pg');
    
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true'
    });

    pool.query('SELECT NOW() as current_time')
        .then(result => {
            console.log('✅ Database connection successful!');
            console.log('Current time:', result.rows[0].current_time);
            
            // Test table creation
            return pool.query(`
                CREATE TABLE IF NOT EXISTS test_connection (
                    id SERIAL PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        })
        .then(() => {
            console.log('✅ Test table created successfully!');
            return pool.query('DROP TABLE IF EXISTS test_connection');
        })
        .then(() => {
            console.log('✅ Test table cleaned up!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Database connection failed:');
            console.error('Error:', error.message);
            console.error('Code:', error.code);
            console.error('Hostname:', error.hostname);
            process.exit(1);
        })
        .finally(() => {
            pool.end();
        });
} else {
    console.log('\n❌ Missing required environment variables!');
    console.log('\n📋 Required variables:');
    console.log('  DB_HOST - PostgreSQL hostname');
    console.log('  DB_NAME - Database name');
    console.log('  DB_USER - Username');
    console.log('  DB_PASSWORD - Password');
    console.log('  DB_SSL=true - Enable SSL');
    
    console.log('\n🔧 How to fix:');
    console.log('1. Go to your Railway project dashboard');
    console.log('2. Click on your PostgreSQL service');
    console.log('3. Go to "Variables" tab');
    console.log('4. Copy PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD');
    console.log('5. Set these in your app service as DB_HOST, DB_PORT, etc.');
    
    process.exit(1);
}
