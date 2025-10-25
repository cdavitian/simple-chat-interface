const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseAccessLogger {
    constructor(options = {}) {
        this.dbPath = options.dbPath || './logs/access.db';
        this.enableConsole = options.enableConsole || false;
        this.tableReady = false;
        
        // Ensure logs directory exists
        const dbDir = path.dirname(this.dbPath);
        const fs = require('fs');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.db = null;
        this.initDatabase();
    }

    initDatabase() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err);
            } else {
                console.log('Connected to SQLite database');
                this.createTables();
            }
        });
    }

    createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS access_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                user_id TEXT NOT NULL,
                email TEXT NOT NULL,
                event_type TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                session_id TEXT,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.run(createTableSQL, (err) => {
            if (err) {
                console.error('Error creating table:', err);
            } else {
                console.log('Access logs table ready');
                this.tableReady = true;
            }
        });
    }

    /**
     * Log user access event
     */
    logAccess(event) {
        // Wait for table to be ready
        if (!this.tableReady) {
            setTimeout(() => this.logAccess(event), 100);
            return;
        }

        const sql = `
            INSERT INTO access_logs 
            (user_id, email, event_type, ip_address, user_agent, session_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            event.userId,
            event.email,
            event.eventType,
            event.ipAddress,
            event.userAgent,
            event.sessionId,
            JSON.stringify(event.metadata || {})
        ];

        this.db.run(sql, params, function(err) {
            if (err) {
                console.error('Error logging access:', err);
            } else {
                if (this.enableConsole) {
                    console.log(`[ACCESS LOG] ${new Date().toISOString()} - ${event.eventType} - ${event.email} - ${event.ipAddress}`);
                }
            }
        });
    }

    /**
     * Query access logs for a specific user
     */
    queryUserLogs(userId, startDate, endDate, limit = 100) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT * FROM access_logs 
                WHERE user_id = ?
            `;
            const params = [userId];

            if (startDate) {
                sql += ' AND timestamp >= ?';
                params.push(startDate);
            }

            if (endDate) {
                sql += ' AND timestamp <= ?';
                params.push(endDate);
            }

            sql += ' ORDER BY timestamp DESC LIMIT ?';
            params.push(limit);

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Parse metadata JSON
                    const logs = rows.map(row => ({
                        ...row,
                        metadata: JSON.parse(row.metadata || '{}')
                    }));
                    resolve(logs);
                }
            });
        });
    }

    /**
     * Get access statistics
     */
    getAccessStats(startDate, endDate) {
        return new Promise((resolve, reject) => {
            let whereClause = 'WHERE 1=1';
            const params = [];

            if (startDate) {
                whereClause += ' AND timestamp >= ?';
                params.push(startDate);
            }

            if (endDate) {
                whereClause += ' AND timestamp <= ?';
                params.push(endDate);
            }

            const sql = `
                SELECT 
                    COUNT(*) as total_logins,
                    COUNT(DISTINCT user_id) as unique_users,
                    event_type,
                    DATE(timestamp) as date,
                    strftime('%H', timestamp) as hour
                FROM access_logs 
                ${whereClause}
                GROUP BY event_type, date, hour
                ORDER BY date DESC, hour DESC
            `;

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const stats = this.processStats(rows);
                    resolve(stats);
                }
            });
        });
    }

    processStats(rows) {
        const stats = {
            totalLogins: 0,
            uniqueUsers: new Set(),
            loginEvents: [],
            hourlyDistribution: {},
            dailyDistribution: {},
            eventTypeDistribution: {}
        };

        rows.forEach(row => {
            if (row.event_type === 'login') {
                stats.totalLogins += row.total_logins;
                stats.uniqueUsers.add(row.user_id);
                
                // Hourly distribution
                const hour = parseInt(row.hour);
                stats.hourlyDistribution[hour] = (stats.hourlyDistribution[hour] || 0) + row.total_logins;
                
                // Daily distribution
                stats.dailyDistribution[row.date] = (stats.dailyDistribution[row.date] || 0) + row.total_logins;
            }
            
            // Event type distribution
            stats.eventTypeDistribution[row.event_type] = (stats.eventTypeDistribution[row.event_type] || 0) + row.total_logins;
        });

        return {
            ...stats,
            uniqueUsers: stats.uniqueUsers.size
        };
    }

    /**
     * Get recent login events
     */
    getRecentLogins(limit = 50) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM access_logs 
                WHERE event_type = 'login'
                ORDER BY timestamp DESC 
                LIMIT ?
            `;

            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const logs = rows.map(row => ({
                        ...row,
                        metadata: JSON.parse(row.metadata || '{}')
                    }));
                    resolve(logs);
                }
            });
        });
    }

    /**
     * Get all users with their access information
     */
    getAllUsers(startDate, endDate) {
        return new Promise((resolve, reject) => {
            let whereClause = 'WHERE 1=1';
            const params = [];

            if (startDate) {
                whereClause += ' AND timestamp >= ?';
                params.push(startDate);
            }

            if (endDate) {
                whereClause += ' AND timestamp <= ?';
                params.push(endDate);
            }

            const sql = `
                SELECT 
                    user_id as userId,
                    email,
                    MIN(timestamp) as firstAccess,
                    MAX(timestamp) as lastAccess,
                    COUNT(CASE WHEN event_type = 'login' THEN 1 END) as totalLogins
                FROM access_logs 
                ${whereClause}
                GROUP BY user_id, email
                ORDER BY lastAccess DESC
            `;

            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Clean up old logs (older than specified days)
     */
    cleanupOldLogs(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const sql = 'DELETE FROM access_logs WHERE timestamp < ?';
        
        this.db.run(sql, [cutoffDate.toISOString()], function(err) {
            if (err) {
                console.error('Error cleaning up old logs:', err);
            } else {
                console.log(`Cleaned up ${this.changes} old log entries`);
            }
        });
    }

    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database connection closed');
                }
            });
        }
    }
}

module.exports = DatabaseAccessLogger;

