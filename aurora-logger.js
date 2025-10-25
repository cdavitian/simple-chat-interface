const mysql = require('mysql2/promise');
const { Pool } = require('pg');

class AuroraLogger {
    constructor(options = {}) {
        this.dbType = options.dbType || 'mysql'; // 'mysql' or 'postgresql'
        this.host = options.host;
        this.port = options.port;
        this.database = options.database;
        this.username = options.username;
        this.password = options.password;
        this.ssl = options.ssl || false;
        this.enableConsole = options.enableConsole || false;
        
        this.connection = null;
        this.initConnection();
    }

    async initConnection() {
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
                    timeout: 60000,
                    reconnect: true
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
            
            console.log(`Connected to Aurora ${this.dbType.toUpperCase()} database`);
        } catch (error) {
            console.error('Failed to connect to Aurora database:', error);
            throw error;
        }
    }

    /**
     * Log user access event
     */
    async logAccess(event) {
        try {
            const sql = this.dbType === 'mysql' 
                ? `INSERT INTO access_logs (user_id, email, event_type, ip_address, user_agent, session_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`
                : `INSERT INTO access_logs (user_id, email, event_type, ip_address, user_agent, session_id, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
            
            const params = [
                event.userId,
                event.email,
                event.eventType,
                event.ipAddress,
                event.userAgent,
                event.sessionId,
                JSON.stringify(event.metadata || {})
            ];

            if (this.dbType === 'mysql') {
                await this.connection.execute(sql, params);
            } else {
                await this.connection.query(sql, params);
            }

            if (this.enableConsole) {
                console.log(`[AURORA LOG] ${new Date().toISOString()} - ${event.eventType} - ${event.email} - ${event.ipAddress}`);
            }
        } catch (error) {
            console.error('Error logging to Aurora:', error);
            throw error;
        }
    }

    /**
     * Query access logs for a specific user
     */
    async queryUserLogs(userId, startDate, endDate, limit = 100) {
        try {
            let sql = this.dbType === 'mysql'
                ? `SELECT * FROM access_logs WHERE user_id = ?`
                : `SELECT * FROM access_logs WHERE user_id = $1`;
            
            const params = [userId];
            let paramCount = this.dbType === 'mysql' ? 1 : 1;

            if (startDate) {
                sql += this.dbType === 'mysql' 
                    ? ' AND timestamp >= ?' 
                    : ` AND timestamp >= $${++paramCount}`;
                params.push(startDate);
            }

            if (endDate) {
                sql += this.dbType === 'mysql' 
                    ? ' AND timestamp <= ?' 
                    : ` AND timestamp <= $${++paramCount}`;
                params.push(endDate);
            }

            sql += this.dbType === 'mysql' 
                ? ' ORDER BY timestamp DESC LIMIT ?' 
                : ` ORDER BY timestamp DESC LIMIT $${++paramCount}`;
            params.push(limit);

            let result;
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute(sql, params);
                result = rows;
            } else {
                result = await this.connection.query(sql, params);
                result = result.rows;
            }

            // Parse metadata JSON
            return result.map(row => ({
                ...row,
                metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
            }));
        } catch (error) {
            console.error('Error querying user logs:', error);
            throw error;
        }
    }

    /**
     * Get access statistics
     */
    async getAccessStats(startDate, endDate) {
        try {
            let sql;
            const params = [];

            if (this.dbType === 'mysql') {
                sql = `
                    SELECT 
                        COUNT(*) as total_events,
                        COUNT(DISTINCT user_id) as unique_users,
                        SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as total_logins,
                        event_type,
                        DATE(timestamp) as date,
                        HOUR(timestamp) as hour
                    FROM access_logs 
                    WHERE 1=1
                `;
                
                if (startDate) {
                    sql += ' AND timestamp >= ?';
                    params.push(startDate);
                }
                if (endDate) {
                    sql += ' AND timestamp <= ?';
                    params.push(endDate);
                }
                
                sql += ' GROUP BY event_type, date, hour ORDER BY date DESC, hour DESC';
            } else {
                sql = `
                    SELECT 
                        COUNT(*) as total_events,
                        COUNT(DISTINCT user_id) as unique_users,
                        SUM(CASE WHEN event_type = 'login' THEN 1 ELSE 0 END) as total_logins,
                        event_type,
                        DATE(timestamp) as date,
                        EXTRACT(HOUR FROM timestamp) as hour
                    FROM access_logs 
                    WHERE 1=1
                `;
                
                if (startDate) {
                    sql += ' AND timestamp >= $1';
                    params.push(startDate);
                }
                if (endDate) {
                    sql += ' AND timestamp <= $2';
                    params.push(endDate);
                }
                
                sql += ' GROUP BY event_type, date, hour ORDER BY date DESC, hour DESC';
            }

            let result;
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute(sql, params);
                result = rows;
            } else {
                result = await this.connection.query(sql, params);
                result = result.rows;
            }

            return this.processStats(result);
        } catch (error) {
            console.error('Error getting access stats:', error);
            throw error;
        }
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
    async getRecentLogins(limit = 50) {
        try {
            const sql = this.dbType === 'mysql'
                ? `SELECT * FROM access_logs WHERE event_type = 'login' ORDER BY timestamp DESC LIMIT ?`
                : `SELECT * FROM access_logs WHERE event_type = 'login' ORDER BY timestamp DESC LIMIT $1`;

            let result;
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute(sql, [limit]);
                result = rows;
            } else {
                result = await this.connection.query(sql, [limit]);
                result = result.rows;
            }

            return result.map(row => ({
                ...row,
                metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
            }));
        } catch (error) {
            console.error('Error getting recent logins:', error);
            throw error;
        }
    }

    /**
     * Get daily statistics using the view
     */
    async getDailyStats(startDate, endDate) {
        try {
            let sql = this.dbType === 'mysql'
                ? `SELECT * FROM daily_stats WHERE 1=1`
                : `SELECT * FROM daily_stats WHERE 1=1`;
            
            const params = [];
            let paramCount = 0;

            if (startDate) {
                sql += this.dbType === 'mysql' 
                    ? ' AND date >= ?' 
                    : ` AND date >= $${++paramCount}`;
                params.push(startDate);
            }

            if (endDate) {
                sql += this.dbType === 'mysql' 
                    ? ' AND date <= ?' 
                    : ` AND date <= $${++paramCount}`;
                params.push(endDate);
            }

            sql += ' ORDER BY date DESC';

            let result;
            if (this.dbType === 'mysql') {
                const [rows] = await this.connection.execute(sql, params);
                result = rows;
            } else {
                result = await this.connection.query(sql, params);
                result = result.rows;
            }

            return result;
        } catch (error) {
            console.error('Error getting daily stats:', error);
            throw error;
        }
    }

    /**
     * Clean up old logs
     */
    async cleanupOldLogs(daysToKeep = 30) {
        try {
            if (this.dbType === 'mysql') {
                const [result] = await this.connection.execute('CALL CleanupOldLogs(?)', [daysToKeep]);
                return result[0].deleted_rows;
            } else {
                const result = await this.connection.query('SELECT cleanup_old_logs($1)', [daysToKeep]);
                return result.rows[0].cleanup_old_logs;
            }
        } catch (error) {
            console.error('Error cleaning up old logs:', error);
            throw error;
        }
    }

    /**
     * Test database connection
     */
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
            console.error('Database connection test failed:', error);
            return false;
        }
    }

    /**
     * Close database connection
     */
    async close() {
        try {
            if (this.connection) {
                if (this.dbType === 'mysql') {
                    await this.connection.end();
                } else {
                    await this.connection.end();
                }
                console.log('Aurora database connection closed');
            }
        } catch (error) {
            console.error('Error closing database connection:', error);
        }
    }
}

module.exports = AuroraLogger;

