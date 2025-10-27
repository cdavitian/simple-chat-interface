const fs = require('fs');
const path = require('path');

class AccessLogger {
    constructor(options = {}) {
        this.logDir = options.logDir || './logs';
        this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
        this.maxFiles = options.maxFiles || 5;
        this.enableConsole = options.enableConsole || false;
        
        // Ensure log directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Log user access event
     * @param {Object} event - Access event data
     * @param {string} event.userId - User identifier
     * @param {string} event.email - User email
     * @param {string} event.eventType - Type of event (login, logout, session_start, etc.)
     * @param {string} event.ipAddress - User's IP address
     * @param {string} event.userAgent - User's browser/device info
     * @param {Object} event.metadata - Additional event data
     */
    logAccess(event) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId: event.userId,
            email: event.email,
            eventType: event.eventType,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            sessionId: event.sessionId,
            metadata: event.metadata || {}
        };

        // Console logging for development
        if (this.enableConsole) {
            console.log(`[ACCESS LOG] ${logEntry.timestamp} - ${event.eventType} - ${event.email} - ${event.ipAddress}`);
        }

        // File logging
        this.writeToFile(logEntry);
    }

    /**
     * Write log entry to file with rotation
     */
    writeToFile(logEntry) {
        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(this.logDir, `access-${today}.jsonl`);
        
        try {
            // Check if file exists and its size
            if (fs.existsSync(logFile)) {
                const stats = fs.statSync(logFile);
                if (stats.size > this.maxFileSize) {
                    this.rotateLogFile(logFile);
                }
            }

            // Append log entry
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Failed to write access log:', error);
        }
    }

    /**
     * Rotate log file when it gets too large
     */
    rotateLogFile(logFile) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = logFile.replace('.jsonl', `-${timestamp}.jsonl`);
        
        try {
            fs.renameSync(logFile, rotatedFile);
            console.log(`Log file rotated: ${rotatedFile}`);
            
            // Clean up old files
            this.cleanupOldLogs();
        } catch (error) {
            console.error('Failed to rotate log file:', error);
        }
    }

    /**
     * Clean up old log files
     */
    cleanupOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('access-') && file.endsWith('.jsonl'))
                .map(file => ({
                    name: file,
                    path: path.join(this.logDir, file),
                    stats: fs.statSync(path.join(this.logDir, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

            // Keep only the most recent files
            if (files.length > this.maxFiles) {
                const filesToDelete = files.slice(this.maxFiles);
                filesToDelete.forEach(file => {
                    fs.unlinkSync(file.path);
                    console.log(`Deleted old log file: ${file.name}`);
                });
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    /**
     * Query access logs for a specific user
     */
    queryUserLogs(userId, startDate, endDate) {
        const logs = [];
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
        const end = endDate ? new Date(endDate) : new Date();

        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('access-') && file.endsWith('.jsonl'));

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line);

                for (const line of lines) {
                    try {
                        const logEntry = JSON.parse(line);
                        const logDate = new Date(logEntry.timestamp);
                        
                        if (logEntry.userId === userId && logDate >= start && logDate <= end) {
                            logs.push(logEntry);
                        }
                    } catch (parseError) {
                        console.error('Failed to parse log line:', parseError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to query user logs:', error);
        }

        return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * Get access statistics
     */
    getAccessStats(startDate, endDate) {
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
        const end = endDate ? new Date(endDate) : new Date();
        
        const stats = {
            totalLogins: 0,
            uniqueUsers: new Set(),
            loginEvents: [],
            hourlyDistribution: {},
            dailyDistribution: {}
        };

        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('access-') && file.endsWith('.jsonl'));

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line);

                for (const line of lines) {
                    try {
                        const logEntry = JSON.parse(line);
                        const logDate = new Date(logEntry.timestamp);
                        
                        if (logDate >= start && logDate <= end) {
                            if (logEntry.eventType === 'login') {
                                stats.totalLogins++;
                                stats.uniqueUsers.add(logEntry.userId);
                                stats.loginEvents.push(logEntry);
                                
                                // Hourly distribution
                                const hour = logDate.getHours();
                                stats.hourlyDistribution[hour] = (stats.hourlyDistribution[hour] || 0) + 1;
                                
                                // Daily distribution
                                const day = logDate.toISOString().split('T')[0];
                                stats.dailyDistribution[day] = (stats.dailyDistribution[day] || 0) + 1;
                            }
                        }
                    } catch (parseError) {
                        console.error('Failed to parse log line:', parseError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get access stats:', error);
        }

        return {
            ...stats,
            uniqueUsers: stats.uniqueUsers.size,
            loginEvents: stats.loginEvents.slice(0, 100) // Limit to last 100 events
        };
    }

    /**
     * Get all users with their access information
     */
    getAllUsers(startDate, endDate) {
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
        const end = endDate ? new Date(endDate) : new Date();
        
        const userMap = new Map();

        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('access-') && file.endsWith('.jsonl'));

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line);

                for (const line of lines) {
                    try {
                        const logEntry = JSON.parse(line);
                        const logDate = new Date(logEntry.timestamp);
                        
                        if (logDate >= start && logDate <= end) {
                            const userId = logEntry.userId;
                            
                            if (!userMap.has(userId)) {
                                userMap.set(userId, {
                                    userId: userId,
                                    email: logEntry.email,
                                    firstAccess: logEntry.timestamp,
                                    lastAccess: logEntry.timestamp,
                                    totalLogins: 0
                                });
                            }
                            
                            const user = userMap.get(userId);
                            
                            // Update first access if this is earlier
                            if (new Date(logEntry.timestamp) < new Date(user.firstAccess)) {
                                user.firstAccess = logEntry.timestamp;
                            }
                            
                            // Update last access if this is later
                            if (new Date(logEntry.timestamp) > new Date(user.lastAccess)) {
                                user.lastAccess = logEntry.timestamp;
                            }
                            
                            // Count login events
                            if (logEntry.eventType === 'login') {
                                user.totalLogins++;
                            }
                        }
                    } catch (parseError) {
                        console.error('Failed to parse log line:', parseError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get all users:', error);
        }

        // Convert map to array and sort by last access
        return Array.from(userMap.values()).sort((a, b) => 
            new Date(b.lastAccess) - new Date(a.lastAccess)
        );
    }

    /**
     * Get all access logs with optional date filtering
     */
    getAllAccessLogs(startDate, endDate) {
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
        const end = endDate ? new Date(endDate) : new Date();
        
        const allLogs = [];

        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('access-') && file.endsWith('.jsonl'));

            for (const file of files) {
                const filePath = path.join(this.logDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.trim().split('\n').filter(line => line);

                for (const line of lines) {
                    try {
                        const logEntry = JSON.parse(line);
                        const logDate = new Date(logEntry.timestamp);
                        
                        if (logDate >= start && logDate <= end) {
                            allLogs.push(logEntry);
                        }
                    } catch (parseError) {
                        console.error('Failed to parse log line:', parseError);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to get all access logs:', error);
        }

        // Sort by timestamp descending (most recent first)
        return allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
}

module.exports = AccessLogger;

