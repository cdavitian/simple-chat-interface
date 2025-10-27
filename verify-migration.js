#!/usr/bin/env node

/**
 * Simple script to verify the Google OAuth migration was successful
 * This script checks if the new columns exist in the access_logs table
 */

const { Pool } = require('pg');
require('dotenv').config();

async function verifyMigration() {
    console.log('🔍 Verifying Google OAuth migration...');
    
    // Configure SSL options to handle self-signed certificates
    const sslConfig = process.env.DB_SSL === 'true' ? {
        rejectUnauthorized: false,
        sslmode: 'require'
    } : false;

    const pool = new Pool({
        host: process.env.PGHOST || process.env.DB_HOST,
        port: process.env.PGPORT || process.env.DB_PORT,
        database: process.env.PGDATABASE || process.env.DB_NAME,
        user: process.env.PGUSER || process.env.DB_USER,
        password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
        ssl: sslConfig
    });

    try {
        // Test connection
        console.log('Testing database connection...');
        const testResult = await pool.query('SELECT NOW() as current_time');
        console.log('✅ Database connection successful. Current time:', testResult.rows[0].current_time);

        // Check if the new columns exist
        console.log('\n🔍 Checking for Google OAuth columns...');
        const checkColumnsSQL = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'access_logs' 
            AND column_name IN ('email_verified', 'family_name', 'given_name', 'full_name', 'picture_url', 'username')
            ORDER BY column_name
        `;
        
        const existingColumns = await pool.query(checkColumnsSQL);
        
        if (existingColumns.rows.length === 0) {
            console.log('❌ No Google OAuth columns found! Migration may have failed.');
            return;
        }

        console.log(`✅ Found ${existingColumns.rows.length} Google OAuth columns:`);
        existingColumns.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });

        // Check if indexes exist
        console.log('\n🔍 Checking for indexes...');
        const checkIndexesSQL = `
            SELECT indexname, indexdef
            FROM pg_indexes 
            WHERE tablename = 'access_logs' 
            AND indexname IN ('idx_access_logs_email_verified', 'idx_access_logs_username')
        `;
        
        const indexes = await pool.query(checkIndexesSQL);
        console.log(`✅ Found ${indexes.rows.length} Google OAuth indexes:`);
        indexes.rows.forEach(row => {
            console.log(`  - ${row.indexname}`);
        });

        // Check table structure
        console.log('\n📊 Current access_logs table structure:');
        const tableStructureSQL = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'access_logs' 
            ORDER BY ordinal_position
        `;
        
        const tableStructure = await pool.query(tableStructureSQL);
        console.log(`Total columns: ${tableStructure.rows.length}`);
        tableStructure.rows.forEach(row => {
            const isGoogleOAuth = ['email_verified', 'family_name', 'given_name', 'full_name', 'picture_url', 'username'].includes(row.column_name);
            const marker = isGoogleOAuth ? '🆕' : '  ';
            console.log(`${marker} ${row.column_name}: ${row.data_type}`);
        });

        console.log('\n🎉 Migration verification complete!');
        
        if (existingColumns.rows.length === 6) {
            console.log('✅ All Google OAuth columns are present and ready to use!');
        } else {
            console.log(`⚠️  Only ${existingColumns.rows.length}/6 Google OAuth columns found.`);
        }

    } catch (error) {
        console.error('❌ Verification failed:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
    } finally {
        await pool.end();
    }
}

// Run the verification
if (require.main === module) {
    verifyMigration().catch(console.error);
}

module.exports = verifyMigration;
