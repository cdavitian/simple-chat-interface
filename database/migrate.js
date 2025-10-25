#!/usr/bin/env node

/**
 * Database Migration Script for Aurora Access Logging
 * 
 * This script helps you set up the database schema for Aurora.
 * Run this after creating your Aurora cluster.
 * 
 * Usage:
 *   node database/migrate.js
 * 
 * Environment variables required:
 *   AURORA_HOST, AURORA_DATABASE, AURORA_USERNAME, AURORA_PASSWORD
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
require('dotenv').config();

class DatabaseMigrator {
    constructor() {
        this.dbType = process.env.AURORA_DB_TYPE || 'mysql';
        this.host = process.env.AURORA_HOST;
        this.port = process.env.AURORA_PORT || (this.dbType === 'postgresql' ? 5432 : 3306);
        this.database = process.env.AURORA_DATABASE;
        this.username = process.env.AURORA_USERNAME;
        this.password = process.env.AURORA_PASSWORD;
        this.ssl = process.env.AURORA_SSL === 'true';
        
        this.connection = null;
    }

    async connect() {
        try {
            if (this.dbType === 'mysql') {
                this.connection = await mysql.createConnection({
                    host: this.host,
                    port: this.port,
                    user: this.username,
                    password: this.password,
                    database: this.database,
                    ssl: this.ssl,
                    acquireTimeout: 60000,
                    timeout: 60000
                });
            } else if (this.dbType === 'postgresql') {
                this.connection = new Pool({
                    host: this.host,
                    port: this.port,
                    database: this.database,
                    user: this.username,
                    password: this.password,
                    ssl: this.ssl,
                    max: 20,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 2000,
                });
            }
            
            console.log(`✅ Connected to Aurora ${this.dbType.toUpperCase()} database`);
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to Aurora database:', error.message);
            return false;
        }
    }

    async runMigration() {
        try {
            const schemaFile = this.dbType === 'postgresql' 
                ? 'database/schema-postgresql.sql'
                : 'database/schema.sql';
            
            const schemaPath = path.join(__dirname, '..', schemaFile);
            
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
                        if (this.dbType === 'mysql') {
                            await this.connection.execute(statement);
                        } else {
                            await this.connection.query(statement);
                        }
                        console.log(`✅ Statement ${i + 1}/${statements.length} executed successfully`);
                    } catch (error) {
                        // Some statements might fail if they already exist (like CREATE TABLE IF NOT EXISTS)
                        if (error.message.includes('already exists') || error.message.includes('already defined')) {
                            console.log(`⚠️  Statement ${i + 1}/${statements.length} skipped (already exists)`);
                        } else {
                            console.error(`❌ Statement ${i + 1}/${statements.length} failed:`, error.message);
                            throw error;
                        }
                    }
                }
            }
            
            console.log('🎉 Database migration completed successfully!');
            return true;
        } catch (error) {
            console.error('❌ Migration failed:', error.message);
            return false;
        }
    }

    async testConnection() {
        try {
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute('SELECT 1 as test');
                return rows[0].test === 1;
            } else {
                const result = await this.connection.query('SELECT 1 as test');
                return result.rows[0].test === 1;
            }
        } catch (error) {
            console.error('❌ Connection test failed:', error.message);
            return false;
        }
    }

    async close() {
        try {
            if (this.connection) {
                if (this.dbType === 'mysql') {
                    await this.connection.end();
                } else {
                    await this.connection.end();
                }
                console.log('🔌 Database connection closed');
            }
        } catch (error) {
            console.error('❌ Error closing connection:', error.message);
        }
    }
}

// Main execution
async function main() {
    console.log('🚀 Starting Aurora database migration...');
    console.log(`📊 Database type: ${process.env.AURORA_DB_TYPE || 'mysql'}`);
    console.log(`🏠 Host: ${process.env.AURORA_HOST}`);
    console.log(`🗄️  Database: ${process.env.AURORA_DATABASE}`);
    
    const migrator = new DatabaseMigrator();
    
    try {
        // Connect to database
        const connected = await migrator.connect();
        if (!connected) {
            process.exit(1);
        }
        
        // Test connection
        const testPassed = await migrator.testConnection();
        if (!testPassed) {
            console.error('❌ Connection test failed');
            process.exit(1);
        }
        console.log('✅ Connection test passed');
        
        // Run migration
        const success = await migrator.runMigration();
        if (!success) {
            process.exit(1);
        }
        
        console.log('🎉 Migration completed successfully!');
        console.log('📋 Next steps:');
        console.log('   1. Update your .env file with Aurora connection details');
        console.log('   2. Set LOGGER_TYPE=aurora in your environment');
        console.log('   3. Restart your application');
        
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

module.exports = DatabaseMigrator;

