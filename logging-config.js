// Logging configuration
const AccessLogger = require('./access-logger');
const DatabaseAccessLogger = require('./database-logger');
const PostgreSQLAccessLogger = require('./postgresql-logger');

// Try to load Aurora logger, but handle missing dependencies gracefully
let AuroraLogger = null;
try {
    AuroraLogger = require('./aurora-logger');
} catch (error) {
    console.warn('Aurora logger not available (missing dependencies):', error.message);
}

class LoggingConfig {
    constructor() {
        // Auto-detect Railway PostgreSQL if available, otherwise use configured type
        this.loggerType = this.detectLoggerType();
        this.logger = null;
        this.initLogger();
    }

    detectLoggerType() {
        // Check if Railway PostgreSQL variables are available
        if (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) {
            console.log('Railway PostgreSQL detected, using PostgreSQL logger');
            return 'postgresql';
        }
        
        // Check if Aurora variables are available
        if (process.env.AURORA_HOST && process.env.AURORA_DATABASE && process.env.AURORA_USER && process.env.AURORA_PASSWORD) {
            console.log('Aurora MySQL detected, using Aurora logger');
            return 'aurora';
        }
        
        // Fall back to configured type or file
        return process.env.LOGGER_TYPE || 'file';
    }

    initLogger() {
        if (this.loggerType === 'postgresql') {
            this.logger = new PostgreSQLAccessLogger({
                enableConsole: process.env.NODE_ENV !== 'production'
            });
        } else if (this.loggerType === 'database') {
            this.logger = new DatabaseAccessLogger({
                dbPath: process.env.DB_PATH || './logs/access.db',
                enableConsole: process.env.NODE_ENV !== 'production'
            });
        } else if (this.loggerType === 'aurora') {
            if (AuroraLogger) {
                this.logger = new AuroraLogger({
                    enableConsole: process.env.NODE_ENV !== 'production'
                });
            } else {
                console.warn('Aurora logger not available, falling back to file logger');
                this.logger = new AccessLogger({
                    logDir: process.env.LOG_DIR || './logs',
                    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
                    maxFiles: parseInt(process.env.MAX_FILES) || 5,
                    enableConsole: process.env.NODE_ENV !== 'production'
                });
            }
        } else {
            // Default to file logger for unsupported types or 'file'
            this.logger = new AccessLogger({
                logDir: process.env.LOG_DIR || './logs',
                maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
                maxFiles: parseInt(process.env.MAX_FILES) || 5,
                enableConsole: process.env.NODE_ENV !== 'production'
            });
        }
    }

    getLogger() {
        return this.logger;
    }

    // Wrapper methods to handle different logger types
    logAccess(event) {
        // Always call the actual logger instance, regardless of configured type
        this.logger.logAccess(event);
    }

    async queryUserLogs(userId, startDate, endDate) {
        // Always call the actual logger instance, regardless of configured type
        return await this.logger.queryUserLogs(userId, startDate, endDate);
    }

    async getAccessStats(startDate, endDate) {
        // Always call the actual logger instance, regardless of configured type
        return await this.logger.getAccessStats(startDate, endDate);
    }

    async getAllUsers(startDate, endDate) {
        // Always call the actual logger instance, regardless of configured type
        return await this.logger.getAllUsers(startDate, endDate);
    }
}

module.exports = LoggingConfig;
