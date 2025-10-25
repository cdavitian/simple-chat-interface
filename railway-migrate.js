#!/usr/bin/env node

/**
 * Railway PostgreSQL Migration Script
 * 
 * This script runs the database migration for Railway PostgreSQL.
 * It uses the existing migrate.js but with Railway-specific environment variables.
 * 
 * Usage:
 *   node railway-migrate.js
 * 
 * Environment variables required (set in Railway):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class RailwayMigrator {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true'
        });
    }

    async connect() {
        try {
            await this.pool.query('SELECT 1');
            console.log('✅ Connected to Railway PostgreSQL database');
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to Railway PostgreSQL:', error.message);
            return false;
        }
    }

    async runMigration() {
        try {
            const schemaPath = path.join(__dirname, 'database', 'schema-postgresql.sql');
            
            if (!fs.existsSync(schemaPath)) {
                throw new Error(`Schema file not found: ${schemaPath}`);
            }
            
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            // Split by semicolon and filter out empty statements
            const statements = schema
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
            
            console.log(`📝 Running ${statements.length} SQL statements...`);
            
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                if (statement.trim()) {
                    try {
                        await this.pool.query(statement);
                        console.log(`✅ Statement ${i + 1}/${statements.length} executed successfully`);
                    } catch (error) {
                        // Some statements might fail if they already exist
                        if (error.message.includes('already exists') || error.message.includes('already defined')) {
                            console.log(`⚠️  Statement ${i + 1}/${statements.length} skipped (already exists)`);
                        } else {
                            console.error(`❌ Statement ${i + 1}/${statements.length} failed:`, error.message);
                            throw error;
                        }
                    }
                }
            }
            
            console.log('🎉 Railway PostgreSQL migration completed successfully!');
            return true;
        } catch (error) {
            console.error('❌ Migration failed:', error.message);
            return false;
        }
    }

    async testTables() {
        try {
            const result = await this.pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'access_logs'
            `);
            
            if (result.rows.length > 0) {
                console.log('✅ access_logs table exists');
                
                // Test inserting a sample record
                await this.pool.query(`
                    INSERT INTO access_logs (user_id, email, event_type, ip_address, user_agent, session_id, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    'test@kyocare.com',
                    'test@kyocare.com',
                    'test',
                    '127.0.0.1',
                    'Railway Migration Test',
                    'test_session',
                    '{"test": true}'
                ]);
                
                console.log('✅ Test record inserted successfully');
                
                // Clean up test record
                await this.pool.query('DELETE FROM access_logs WHERE user_id = $1', ['test@kyocare.com']);
                console.log('✅ Test record cleaned up');
                
                return true;
            } else {
                console.log('❌ access_logs table does not exist');
                return false;
            }
        } catch (error) {
            console.error('❌ Table test failed:', error.message);
            return false;
        }
    }

    async close() {
        try {
            await this.pool.end();
            console.log('🔌 Database connection closed');
        } catch (error) {
            console.error('❌ Error closing connection:', error.message);
        }
    }
}

// Main execution
async function main() {
    console.log('🚀 Starting Railway PostgreSQL migration...');
    console.log(`🏠 Host: ${process.env.DB_HOST}`);
    console.log(`🗄️  Database: ${process.env.DB_NAME}`);
    console.log(`👤 User: ${process.env.DB_USER}`);
    
    const migrator = new RailwayMigrator();
    
    try {
        // Connect to database
        const connected = await migrator.connect();
        if (!connected) {
            process.exit(1);
        }
        
        // Run migration
        const success = await migrator.runMigration();
        if (!success) {
            process.exit(1);
        }
        
        // Test tables
        const tablesOk = await migrator.testTables();
        if (!tablesOk) {
            console.error('❌ Table test failed');
            process.exit(1);
        }
        
        console.log('🎉 Railway PostgreSQL setup completed successfully!');
        console.log('📋 Your database is ready for use');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await migrator.close();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = RailwayMigrator;
