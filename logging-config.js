// Simplified logging configuration - PostgreSQL only
const AccessLogger = require('./access-logger');
const PostgreSQLAccessLogger = require('./postgresql-logger');

class LoggingConfig {
    constructor() {
        this.loggerType = this.detectLoggerType();
        this.logger = null;
        this.initLogger();
    }

    detectLoggerType() {
        // Check if Railway PostgreSQL variables are available (DB_* or PG_*)
        const hasPostgreSQLVars = (
            (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) ||
            (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD)
        );
        
        if (hasPostgreSQLVars) {
            console.log('PostgreSQL database detected, using PostgreSQL logger');
            return 'postgresql';
        }
        
        // Fall back to file logger if no database is available
        console.log('No PostgreSQL database detected, using file logger');
        return 'file';
    }

    initLogger() {
        if (this.loggerType === 'postgresql') {
            this.logger = new PostgreSQLAccessLogger({
                enableConsole: process.env.NODE_ENV !== 'production'
            });
        } else {
            // Default to file logger
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
    async logAccess(event) {
        // Always call the actual logger instance, regardless of configured type
        return await this.logger.logAccess(event);
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

    async getAllAccessLogs(startDate, endDate) {
        // Always call the actual logger instance, regardless of configured type
        return await this.logger.getAllAccessLogs(startDate, endDate);
    }
}

module.exports = LoggingConfig;