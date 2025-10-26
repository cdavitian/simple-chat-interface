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
        this.loggerType = process.env.LOGGER_TYPE || 'file'; // 'file', 'database', 'postgresql', or 'aurora'
        this.logger = null;
        this.initLogger();
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
        if (this.loggerType === 'database' || this.loggerType === 'postgresql' || this.loggerType === 'aurora') {
            this.logger.logAccess(event);
        } else {
            this.logger.logAccess(event);
        }
    }

    async queryUserLogs(userId, startDate, endDate) {
        if (this.loggerType === 'database' || this.loggerType === 'postgresql' || this.loggerType === 'aurora') {
            return await this.logger.queryUserLogs(userId, startDate, endDate);
        } else {
            return this.logger.queryUserLogs(userId, startDate, endDate);
        }
    }

    async getAccessStats(startDate, endDate) {
        if (this.loggerType === 'database' || this.loggerType === 'postgresql' || this.loggerType === 'aurora') {
            return await this.logger.getAccessStats(startDate, endDate);
        } else {
            return this.logger.getAccessStats(startDate, endDate);
        }
    }

    async getAllUsers(startDate, endDate) {
        if (this.loggerType === 'database' || this.loggerType === 'postgresql' || this.loggerType === 'aurora') {
            return await this.logger.getAllUsers(startDate, endDate);
        } else {
            return this.logger.getAllUsers(startDate, endDate);
        }
    }
}

module.exports = LoggingConfig;
