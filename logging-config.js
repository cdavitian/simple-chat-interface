// Logging configuration
const AccessLogger = require('./access-logger');
const DatabaseAccessLogger = require('./database-logger');
const PostgreSQLAccessLogger = require('./postgresql-logger');

class LoggingConfig {
    constructor() {
        this.loggerType = process.env.LOGGER_TYPE || 'file'; // 'file', 'database', or 'postgresql'
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
        } else {
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

    // Wrapper methods to handle both logger types
    logAccess(event) {
        if (this.loggerType === 'database') {
            this.logger.logAccess(event);
        } else {
            this.logger.logAccess(event);
        }
    }

    async queryUserLogs(userId, startDate, endDate) {
        if (this.loggerType === 'database') {
            return await this.logger.queryUserLogs(userId, startDate, endDate);
        } else {
            return this.logger.queryUserLogs(userId, startDate, endDate);
        }
    }

    async getAccessStats(startDate, endDate) {
        if (this.loggerType === 'database') {
            return await this.logger.getAccessStats(startDate, endDate);
        } else {
            return this.logger.getAccessStats(startDate, endDate);
        }
    }

    async getAllUsers(startDate, endDate) {
        if (this.loggerType === 'database') {
            return await this.logger.getAllUsers(startDate, endDate);
        } else {
            return this.logger.getAllUsers(startDate, endDate);
        }
    }
}

module.exports = LoggingConfig;
