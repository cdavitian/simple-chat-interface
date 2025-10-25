const { Pool } = require('pg');

class PostgreSQLAccessLogger {
    constructor(options = {}) {
        this.pool = new Pool({
            host: options.host || process.env.DB_HOST,
            port: options.port || process.env.DB_PORT,
            database: options.database || process.env.DB_NAME,
            user: options.user || process.env.DB_USER,
            password: options.password || process.env.DB_PASSWORD,
            ssl: options.ssl || process.env.DB_SSL === 'true'
        });
        
        this.enableConsole = options.enableConsole || false;
        this.initDatabase();
    }

    async initDatabase() {
        try {
            await this.createTables();
            console.log('PostgreSQL database initialized');
        } catch (error) {
            console.error('Error initializing database:', error);
        }
    }

    async createTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS access_logs (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_id VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                ip_address INET,
                user_agent TEXT,
                session_id VARCHAR(255),
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await this.pool.query(createTableSQL);
    }

    async logAccess(event) {
        const sql = `
            INSERT INTO access_logs 
            (user_id, email, event_type, ip_address, user_agent, session_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        const values = [
            event.userId,
            event.email,
            event.eventType,
            event.ipAddress,
            event.userAgent,
            event.sessionId,
            JSON.stringify(event.metadata || {})
        ];

        try {
            await this.pool.query(sql, values);
            if (this.enableConsole) {
                console.log(`[ACCESS LOG] ${new Date().toISOString()} - ${event.eventType} - ${event.email} - ${event.ipAddress}`);
            }
        } catch (error) {
            console.error('Error logging access:', error);
        }
    }

    async queryUserLogs(userId, startDate, endDate, limit = 100) {
        let sql = 'SELECT * FROM access_logs WHERE user_id = $1';
        const values = [userId];
        let paramCount = 1;

        if (startDate) {
            sql += ` AND timestamp >= $${++paramCount}`;
            values.push(startDate);
        }

        if (endDate) {
            sql += ` AND timestamp <= $${++paramCount}`;
            values.push(endDate);
        }

        sql += ` ORDER BY timestamp DESC LIMIT $${++paramCount}`;
        values.push(limit);

        const result = await this.pool.query(sql, values);
        return result.rows;
    }

    async getAccessStats(startDate, endDate) {
        let whereClause = 'WHERE 1=1';
        const values = [];
        let paramCount = 0;

        if (startDate) {
            whereClause += ` AND timestamp >= $${++paramCount}`;
            values.push(startDate);
        }

        if (endDate) {
            whereClause += ` AND timestamp <= $${++paramCount}`;
            values.push(endDate);
        }

        const sql = `
            SELECT 
                COUNT(*) as total_logins,
                COUNT(DISTINCT user_id) as unique_users,
                event_type,
                DATE(timestamp) as date,
                EXTRACT(HOUR FROM timestamp) as hour
            FROM access_logs 
            ${whereClause}
            GROUP BY event_type, date, hour
            ORDER BY date DESC, hour DESC
        `;

        const result = await this.pool.query(sql, values);
        return this.processStats(result.rows);
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
                stats.totalLogins += parseInt(row.total_logins);
                stats.uniqueUsers.add(row.user_id);
                
                const hour = parseInt(row.hour);
                stats.hourlyDistribution[hour] = (stats.hourlyDistribution[hour] || 0) + parseInt(row.total_logins);
                stats.dailyDistribution[row.date] = (stats.dailyDistribution[row.date] || 0) + parseInt(row.total_logins);
            }
            
            stats.eventTypeDistribution[row.event_type] = (stats.eventTypeDistribution[row.event_type] || 0) + parseInt(row.total_logins);
        });

        return {
            ...stats,
            uniqueUsers: stats.uniqueUsers.size
        };
    }

    async getRecentLogins(limit = 50) {
        const sql = `
            SELECT * FROM access_logs 
            WHERE event_type = 'login'
            ORDER BY timestamp DESC 
            LIMIT $1
        `;

        const result = await this.pool.query(sql, [limit]);
        return result.rows;
    }

    async cleanupOldLogs(daysToKeep = 30) {
        const sql = `DELETE FROM access_logs WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'`;
        const result = await this.pool.query(sql);
        return result.rowCount;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgreSQLAccessLogger;
