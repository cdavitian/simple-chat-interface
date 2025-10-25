#!/usr/bin/env node

/**
 * Database Backup Script
 * 
 * This script creates a backup of your SQLite database before deployment.
 * Run this before any deployment to preserve your data.
 * 
 * Usage:
 *   node backup-database.js
 *   node backup-database.js --restore
 */

const fs = require('fs');
const path = require('path');

class DatabaseBackup {
    constructor() {
        this.dbPath = process.env.DB_PATH || './logs/access.db';
        this.backupDir = './backups';
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
            console.log(`📁 Created backup directory: ${this.backupDir}`);
        }
    }

    backup() {
        if (!fs.existsSync(this.dbPath)) {
            console.log('⚠️  Database file not found. Nothing to backup.');
            return false;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `access-${timestamp}.db`);
        
        try {
            fs.copyFileSync(this.dbPath, backupPath);
            const stats = fs.statSync(this.dbPath);
            
            console.log('✅ Database backup created successfully!');
            console.log(`📄 Source: ${this.dbPath}`);
            console.log(`💾 Backup: ${backupPath}`);
            console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
            
            // Keep only last 5 backups
            this.cleanupOldBackups();
            
            return true;
        } catch (error) {
            console.error('❌ Backup failed:', error.message);
            return false;
        }
    }

    restore() {
        const backups = this.getBackupFiles();
        
        if (backups.length === 0) {
            console.log('⚠️  No backup files found.');
            return false;
        }

        // Use the most recent backup
        const latestBackup = backups[0];
        
        try {
            // Ensure logs directory exists
            const logsDir = path.dirname(this.dbPath);
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            fs.copyFileSync(latestBackup, this.dbPath);
            console.log('✅ Database restored successfully!');
            console.log(`📄 Restored from: ${latestBackup}`);
            console.log(`💾 To: ${this.dbPath}`);
            
            return true;
        } catch (error) {
            console.error('❌ Restore failed:', error.message);
            return false;
        }
    }

    getBackupFiles() {
        if (!fs.existsSync(this.backupDir)) {
            return [];
        }

        return fs.readdirSync(this.backupDir)
            .filter(file => file.startsWith('access-') && file.endsWith('.db'))
            .map(file => path.join(this.backupDir, file))
            .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);
    }

    cleanupOldBackups() {
        const backups = this.getBackupFiles();
        const maxBackups = 5;

        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            
            toDelete.forEach(backup => {
                try {
                    fs.unlinkSync(backup);
                    console.log(`🗑️  Deleted old backup: ${path.basename(backup)}`);
                } catch (error) {
                    console.error(`⚠️  Failed to delete ${backup}:`, error.message);
                }
            });
        }
    }

    listBackups() {
        const backups = this.getBackupFiles();
        
        if (backups.length === 0) {
            console.log('📋 No backup files found.');
            return;
        }

        console.log('📋 Available backups:');
        backups.forEach((backup, index) => {
            const stats = fs.statSync(backup);
            const size = (stats.size / 1024).toFixed(2);
            const date = stats.mtime.toISOString();
            console.log(`  ${index + 1}. ${path.basename(backup)} (${size} KB, ${date})`);
        });
    }
}

// Main execution
function main() {
    const args = process.argv.slice(2);
    const backup = new DatabaseBackup();

    console.log('🗄️  Database Backup Utility');
    console.log('============================');

    if (args.includes('--restore')) {
        console.log('🔄 Restoring database...');
        backup.restore();
    } else if (args.includes('--list')) {
        backup.listBackups();
    } else {
        console.log('💾 Creating database backup...');
        const success = backup.backup();
        
        if (success) {
            console.log('\n🎉 Backup completed successfully!');
            console.log('💡 Tip: Run this script before each deployment to preserve your data.');
        } else {
            console.log('\n❌ Backup failed. Check the error messages above.');
            process.exit(1);
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = DatabaseBackup;
