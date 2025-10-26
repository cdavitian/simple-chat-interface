#!/usr/bin/env node

/**
 * Migration script to add Google OAuth attributes to existing access_logs table
 * This script will add the new columns to the database without losing existing data
 */

const { Pool } = require('pg');
require('dotenv').config();

async function migrateDatabase() {
    console.log('Starting migration to add Google OAuth attributes...');
    
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
        console.log('Database connection successful. Current time:', testResult.rows[0].current_time);

        // Check if columns already exist
        console.log('Checking if Google OAuth columns already exist...');
        const checkColumnsSQL = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'access_logs' 
            AND column_name IN ('email_verified', 'family_name', 'given_name', 'full_name', 'picture_url', 'username')
        `;
        
        const existingColumns = await pool.query(checkColumnsSQL);
        const existingColumnNames = existingColumns.rows.map(row => row.column_name);
        
        if (existingColumnNames.length > 0) {
            console.log('Some Google OAuth columns already exist:', existingColumnNames);
        }

        // Add missing columns
        const addColumnsSQL = `
            ALTER TABLE access_logs 
            ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS family_name VARCHAR(255) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS given_name VARCHAR(255) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS picture_url VARCHAR(500) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT NULL
        `;

        console.log('Adding Google OAuth columns...');
        await pool.query(addColumnsSQL);
        console.log('Google OAuth columns added successfully');

        // Add indexes for the new columns
        const indexSQL = [
            'CREATE INDEX IF NOT EXISTS idx_access_logs_email_verified ON access_logs(email_verified)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_username ON access_logs(username)'
        ];

        console.log('Creating indexes for new columns...');
        for (const sql of indexSQL) {
            try {
                await pool.query(sql);
                console.log(`Created index: ${sql.split(' ')[5]}`);
            } catch (error) {
                console.warn(`Warning: Could not create index: ${sql}`, error.message);
            }
        }

        // Verify the migration
        console.log('Verifying migration...');
        const verifySQL = `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'access_logs' 
            AND column_name IN ('email_verified', 'family_name', 'given_name', 'full_name', 'picture_url', 'username')
            ORDER BY column_name
        `;
        
        const verifyResult = await pool.query(verifySQL);
        console.log('New columns added:');
        verifyResult.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default})`);
        });

        console.log('Migration completed successfully!');
        console.log('The access_logs table now includes Google OAuth attributes from Cognito.');

    } catch (error) {
        console.error('Migration failed:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run the migration
if (require.main === module) {
    migrateDatabase().catch(console.error);
}

module.exports = migrateDatabase;
