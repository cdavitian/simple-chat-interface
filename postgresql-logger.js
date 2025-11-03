const { Pool } = require('pg');

class PostgreSQLAccessLogger {
    constructor(options = {}) {
        // Configure SSL options to handle self-signed certificates
        const sslConfig = process.env.DB_SSL === 'true' ? {
            rejectUnauthorized: false, // Allow self-signed certificates
            sslmode: 'require'
        } : false;

        this.pool = new Pool({
            host: options.host || process.env.PGHOST || process.env.DB_HOST,
            port: options.port || process.env.PGPORT || process.env.DB_PORT,
            database: options.database || process.env.PGDATABASE || process.env.DB_NAME,
            user: options.user || process.env.PGUSER || process.env.DB_USER,
            password: options.password || process.env.PGPASSWORD || process.env.DB_PASSWORD,
            ssl: sslConfig
        });
        
        this.enableConsole = options.enableConsole || false;
        this.initDatabase();
    }

    async initDatabase() {
        try {
            console.log('Initializing PostgreSQL database...');
            console.log('Database config:', {
                host: process.env.PGHOST || process.env.DB_HOST,
                port: process.env.PGPORT || process.env.DB_PORT,
                database: process.env.PGDATABASE || process.env.DB_NAME,
                user: process.env.PGUSER || process.env.DB_USER,
                ssl: process.env.DB_SSL
            });
            
            await this.createTables();
            console.log('PostgreSQL database initialized successfully');
        } catch (error) {
            console.error('Error initializing database:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                detail: error.detail
            });
        }
    }

    async createTables() {
        // Test connection first
        console.log('Testing database connection...');
        const testResult = await this.pool.query('SELECT NOW() as current_time');
        console.log('Database connection successful. Current time:', testResult.rows[0].current_time);

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                -- Google OAuth attributes from Cognito
                email_verified BOOLEAN DEFAULT NULL,
                family_name VARCHAR(255) DEFAULT NULL,
                given_name VARCHAR(255) DEFAULT NULL,
                full_name VARCHAR(255) DEFAULT NULL,
                picture_url VARCHAR(500) DEFAULT NULL,
                username VARCHAR(255) DEFAULT NULL
            )
        `;

        console.log('Creating access_logs table...');
        await this.pool.query(createTableSQL);
        console.log('access_logs table created successfully');

        // Create indexes for better performance
        const indexSQL = [
            'CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_event_type ON access_logs(event_type)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_session_id ON access_logs(session_id)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_user_timestamp ON access_logs(user_id, timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_email_verified ON access_logs(email_verified)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_username ON access_logs(username)',
            'CREATE INDEX IF NOT EXISTS idx_access_logs_metadata ON access_logs USING GIN(metadata)'
        ];

        for (const sql of indexSQL) {
            try {
                await this.pool.query(sql);
            } catch (error) {
                console.warn(`Warning: Could not create index: ${sql}`, error.message);
            }
        }

        // Create permanent session log table
        await this.createSessionLogTable();
        
        // Add foreign key relationship between access_logs.session_id and sessions_log.session_id
        await this.addSessionIdForeignKey();
    }

    async addSessionIdForeignKey() {
        try {
            // Check if foreign key already exists
            const checkFkSQL = `
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE constraint_name = 'fk_access_logs_session_id' 
                AND table_name = 'access_logs'
            `;
            const fkExists = await this.pool.query(checkFkSQL);
            
            if (fkExists.rows.length === 0) {
                // Add foreign key constraint to link access_logs.session_id to sessions_log.session_id
                // Using ON DELETE SET NULL to handle cases where session might be deleted
                const addFkSQL = `
                    ALTER TABLE access_logs 
                    ADD CONSTRAINT fk_access_logs_session_id 
                    FOREIGN KEY (session_id) 
                    REFERENCES sessions_log(session_id) 
                    ON DELETE SET NULL
                `;
                
                await this.pool.query(addFkSQL);
                console.log('✅ Foreign key constraint added: access_logs.session_id -> sessions_log.session_id');
            } else {
                console.log('✅ Foreign key constraint already exists');
            }
        } catch (error) {
            // Foreign key constraint might fail if there are existing records with orphaned session_ids
            // or if sessions_log table doesn't exist yet. This is non-critical.
            console.warn('Warning: Could not add foreign key constraint (this is OK if tables already have data):', error.message);
        }
    }

    async createSessionLogTable() {
        const createSessionLogSQL = `
            CREATE TABLE IF NOT EXISTS sessions_log (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL UNIQUE,
                initiation_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_id VARCHAR(255),
                user_email VARCHAR(255),
                expiration_timestamp TIMESTAMP,
                termination_timestamp TIMESTAMP,
                ip_address INET,
                user_agent TEXT,
                termination_reason VARCHAR(50), -- 'expired', 'logout', 'server_restart', etc.
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        console.log('Creating sessions_log table...');
        await this.pool.query(createSessionLogSQL);
        console.log('sessions_log table created successfully');

        // Create indexes for sessions_log
        const sessionIndexSQL = [
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_session_id ON sessions_log(session_id)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_user_id ON sessions_log(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_user_email ON sessions_log(user_email)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_initiation_timestamp ON sessions_log(initiation_timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_termination_timestamp ON sessions_log(termination_timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_log_user_initiation ON sessions_log(user_id, initiation_timestamp)'
        ];

        for (const sql of sessionIndexSQL) {
            try {
                await this.pool.query(sql);
            } catch (error) {
                console.warn(`Warning: Could not create index: ${sql}`, error.message);
            }
        }
    }

    async logAccess(event) {
        const sql = `
            INSERT INTO access_logs 
            (user_id, email, event_type, ip_address, user_agent, session_id, metadata, 
             email_verified, family_name, given_name, full_name, picture_url, username)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;

        const values = [
            event.userId,
            event.email,
            event.eventType,
            event.ipAddress,
            event.userAgent,
            event.sessionId,
            JSON.stringify(event.metadata || {}),
            // Google OAuth attributes
            event.emailVerified || null,
            event.familyName || null,
            event.givenName || null,
            event.fullName || null,
            event.pictureUrl || null,
            event.username || null
        ];

        try {
            await this.pool.query(sql, values);
            
            // Update users table for login events
            if (event.eventType === 'login') {
                await this.updateUsersTable(event);
            }
            
            if (this.enableConsole) {
                console.log(`[ACCESS LOG] ${new Date().toISOString()} - ${event.eventType} - ${event.email} - ${event.ipAddress}`);
            }
        } catch (error) {
            console.error('Error logging access:', error);
        }
    }

    async updateUsersTable(event) {
        try {
            // First, check if users table exists, if not create it
            await this.ensureUsersTableExists();
            
            const currentTimestamp = new Date().toISOString();
            
            // Insert or update user in users table
            const upsertSQL = `
                INSERT INTO users (user_id, created, last_login, email, family_name, given_name, full_name, user_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (user_id) DO UPDATE SET
                    last_login = EXCLUDED.last_login,
                    email = EXCLUDED.email,
                    family_name = EXCLUDED.family_name,
                    given_name = EXCLUDED.given_name,
                    full_name = EXCLUDED.full_name,
                    updated_at = CURRENT_TIMESTAMP
            `;

            const values = [
                event.userId,
                currentTimestamp, // created (will be updated to first login if user already exists)
                currentTimestamp, // last_login
                event.email,
                event.familyName || null,
                event.givenName || null,
                event.fullName || null,
                'New' // user_type
            ];

            await this.pool.query(upsertSQL, values);
            
            // Update created timestamp to first login if this is a new user
            const updateCreatedSQL = `
                UPDATE users 
                SET created = (
                    SELECT MIN(timestamp) 
                    FROM access_logs 
                    WHERE user_id = $1 AND event_type = 'login'
                )
                WHERE user_id = $1 AND created = last_login
            `;
            
            await this.pool.query(updateCreatedSQL, [event.userId]);
            
        } catch (error) {
            console.error('Error updating users table:', error);
        }
    }

    async ensureUsersTableExists() {
        try {
            // Check if users table exists
            const checkTableSQL = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'users'
                );
            `;
            
            const result = await this.pool.query(checkTableSQL);
            
            if (!result.rows[0].exists) {
                console.log('Users table does not exist, creating it...');
                
                // Read and execute the migration SQL
                const fs = require('fs');
                const path = require('path');
                const migrationSQL = fs.readFileSync(path.join(__dirname, 'database', 'migrate-create-users-table.sql'), 'utf8');
                
                await this.pool.query(migrationSQL);
                console.log('Users table created successfully');
            }
        } catch (error) {
            console.error('Error ensuring users table exists:', error);
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
            // Add 1 day to endDate to include the full day
            const endDatePlusOne = new Date(endDate);
            endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
            sql += ` AND timestamp < $${++paramCount}`;
            values.push(endDatePlusOne.toISOString().split('T')[0]);
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
            // Add 1 day to endDate to include the full day
            const endDatePlusOne = new Date(endDate);
            endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
            whereClause += ` AND timestamp < $${++paramCount}`;
            values.push(endDatePlusOne.toISOString().split('T')[0]);
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

    async getAllUsers(userType, userName) {
        // First ensure users table exists
        await this.ensureUsersTableExists();
        
        let whereClause = 'WHERE 1=1';
        const values = [];
        let paramCount = 0;

        if (userType) {
            whereClause += ` AND u.user_type = $${++paramCount}`;
            values.push(userType);
        }

        if (userName) {
            whereClause += ` AND (CONCAT(u.given_name, ' ', u.family_name) ILIKE $${++paramCount} OR u.full_name ILIKE $${++paramCount})`;
            const searchPattern = `%${userName}%`;
            values.push(searchPattern);
            values.push(searchPattern);
        }

        const sql = `
            SELECT 
                u.user_id as "userId",
                u.email,
                u.created as "firstAccess",
                u.last_login as "lastAccess",
                u.family_name as "familyName",
                u.given_name as "givenName",
                u.full_name as "fullName",
                u.user_type as "userType",
                u.created_at as "createdAt",
                u.updated_at as "updatedAt",
                COALESCE(login_stats.total_logins, 0) as "totalLogins"
            FROM users u
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(*) as total_logins
                FROM access_logs 
                WHERE event_type = 'login'
                GROUP BY user_id
            ) login_stats ON u.user_id = login_stats.user_id
            ${whereClause}
            ORDER BY u.last_login DESC
        `;

        const result = await this.pool.query(sql, values);
        return result.rows;
    }

    async searchUserNames(query) {
        // First ensure users table exists
        await this.ensureUsersTableExists();
        
        const searchPattern = `%${query}%`;
        
        const sql = `
            SELECT DISTINCT 
                CASE 
                    WHEN u.full_name IS NOT NULL AND u.full_name != '' THEN u.full_name
                    WHEN u.given_name IS NOT NULL AND u.family_name IS NOT NULL THEN CONCAT(u.given_name, ' ', u.family_name)
                    WHEN u.given_name IS NOT NULL THEN u.given_name
                    WHEN u.family_name IS NOT NULL THEN u.family_name
                    ELSE u.email
                END as display_name
            FROM users u
            WHERE (
                u.full_name ILIKE $1 OR 
                u.given_name ILIKE $1 OR 
                u.family_name ILIKE $1 OR
                CONCAT(u.given_name, ' ', u.family_name) ILIKE $1
            )
            ORDER BY display_name
            LIMIT 10
        `;

        const result = await this.pool.query(sql, [searchPattern]);
        return result.rows.map(row => row.display_name).filter(name => name && name.trim() !== '');
    }

    async getAllAccessLogs(startDate, endDate) {
        let whereClause = 'WHERE 1=1';
        const values = [];
        let paramCount = 0;

        if (startDate) {
            whereClause += ` AND timestamp >= $${++paramCount}`;
            values.push(startDate);
        }

        if (endDate) {
            // Add 1 day to endDate to include the full day
            const endDatePlusOne = new Date(endDate);
            endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
            whereClause += ` AND timestamp < $${++paramCount}`;
            values.push(endDatePlusOne.toISOString().split('T')[0]);
        }

        const sql = `
            SELECT * FROM access_logs 
            ${whereClause}
            ORDER BY timestamp DESC 
            LIMIT 1000
        `;
        
        const result = await this.pool.query(sql, values);
        return result.rows;
    }

    async cleanupOldLogs(daysToKeep = 30) {
        const sql = `DELETE FROM access_logs WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'`;
        const result = await this.pool.query(sql);
        return result.rowCount;
    }

    /**
     * Log session initiation to permanent sessions_log table
     * @param {Object} sessionData - Session data including session_id, user_id, user_email, expiration_timestamp, ip_address, user_agent
     */
    async logSessionInitiation(sessionData) {
        try {
            const {
                session_id,
                user_id,
                user_email,
                expiration_timestamp,
                ip_address,
                user_agent,
                metadata = {}
            } = sessionData;

            // Check if session already exists to avoid duplicates
            const checkSql = `SELECT session_id FROM sessions_log WHERE session_id = $1`;
            const checkResult = await this.pool.query(checkSql, [session_id]);
            
            if (checkResult.rows.length === 0) {
                const sql = `
                    INSERT INTO sessions_log 
                    (session_id, initiation_timestamp, user_id, user_email, expiration_timestamp, ip_address, user_agent, metadata)
                    VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7)
                `;

                await this.pool.query(sql, [
                    session_id,
                    user_id || null,
                    user_email || null,
                    expiration_timestamp || null,
                    ip_address || null,
                    user_agent || null,
                    JSON.stringify(metadata)
                ]);
            }
        } catch (error) {
            console.error('Error logging session initiation:', error);
            // Don't throw - session logging shouldn't break the app
        }
    }

    /**
     * Log session termination to permanent sessions_log table
     * @param {Object} sessionData - Session data including session_id, termination_reason, metadata
     */
    async logSessionTermination(sessionData) {
        try {
            const {
                session_id,
                termination_reason = 'expired',
                metadata = {}
            } = sessionData;

            const sql = `
                UPDATE sessions_log 
                SET termination_timestamp = CURRENT_TIMESTAMP,
                    termination_reason = $1,
                    metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
                WHERE session_id = $3 AND termination_timestamp IS NULL
            `;

            const result = await this.pool.query(sql, [
                termination_reason,
                JSON.stringify(metadata),
                session_id
            ]);

            if (result.rowCount === 0) {
                // Session not found in log - might be a new session or already terminated
                console.warn(`Session ${session_id} not found in sessions_log for termination update`);
            }
        } catch (error) {
            console.error('Error logging session termination:', error);
            // Don't throw - session logging shouldn't break the app
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgreSQLAccessLogger;
