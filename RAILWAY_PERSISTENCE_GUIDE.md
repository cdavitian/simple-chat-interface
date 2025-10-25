# Railway Database Persistence Guide

## 🚨 **CRITICAL: Railway Data Persistence**

**Your SQLite database will be LOST on every Railway deployment unless you configure persistence.**

## 📋 **Railway Persistence Options**

### ❌ **What WON'T Work on Railway**
- Local SQLite file (`./logs/access.db`) - **Data will be lost on every deployment**
- File-based storage - Railway containers are ephemeral
- Local file system - Not persistent across deployments

### ✅ **What WILL Work on Railway**

#### Option 1: Railway PostgreSQL (Recommended)
Railway provides managed PostgreSQL databases that persist across deployments.

#### Option 2: External Database Service
Use an external database service (AWS RDS, PlanetScale, etc.)

#### Option 3: Railway Volumes (Limited)
Railway has limited volume support - not recommended for production databases.

## 🚀 **Recommended Solution: Railway PostgreSQL**

### Step 1: Add PostgreSQL to Your Railway Project

1. **Go to your Railway project dashboard**
2. **Click "New" → "Database" → "PostgreSQL"**
3. **Railway will create a PostgreSQL database for you**
4. **Note the connection details (you'll need these)**

### Step 2: Update Your Environment Variables

Add these to your Railway project variables:

```bash
# Database Configuration
LOGGER_TYPE=postgresql
DB_HOST=your-postgres-host.railway.internal
DB_PORT=5432
DB_NAME=railway
DB_USER=postgres
DB_PASSWORD=your-postgres-password
DB_SSL=true
```

### Step 3: Install PostgreSQL Dependencies

Update your `package.json` to include PostgreSQL support:

```json
{
  "dependencies": {
    "pg": "^8.11.3"
  }
}
```

### Step 4: Create PostgreSQL Logger

Create a new PostgreSQL logger for Railway:

```javascript
// postgresql-logger.js
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
        const sql = 'DELETE FROM access_logs WHERE timestamp < NOW() - INTERVAL \'${daysToKeep} days\'';
        const result = await this.pool.query(sql);
        return result.rowCount;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgreSQLAccessLogger;
```

### Step 5: Update Logging Configuration

Update your `logging-config.js` to support PostgreSQL:

```javascript
// Add this to logging-config.js
const PostgreSQLAccessLogger = require('./postgresql-logger');

// Update the initLogger method
initLogger() {
    if (this.loggerType === 'postgresql') {
        this.logger = new PostgreSQLAccessLogger({
            enableConsole: process.env.NODE_ENV !== 'production'
        });
    } else if (this.loggerType === 'database') {
        // ... existing SQLite code
    } else {
        // ... existing file logger code
    }
}
```

## 🔧 **Alternative: Keep SQLite with Railway Volumes**

If you prefer to keep SQLite, you can use Railway volumes (limited support):

### Step 1: Add Volume to Railway Project

1. **Go to your Railway project**
2. **Click "New" → "Volume"**
3. **Name it "logs"**
4. **Mount path: `/app/logs`**

### Step 2: Update Railway Configuration

Update your `railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "volumes": [
      {
        "name": "logs",
        "mountPath": "/app/logs"
      }
    ]
  }
}
```

### Step 3: Update Environment Variables

```bash
LOGGER_TYPE=database
DB_PATH=/app/logs/access.db
```

## 🎯 **Recommended Approach for Railway**

**Use Railway PostgreSQL** - it's the most reliable and scalable option:

1. ✅ **Persistent** - Data survives deployments
2. ✅ **Scalable** - Can handle multiple app instances
3. ✅ **Managed** - Railway handles backups and maintenance
4. ✅ **Production-ready** - Suitable for production use

## 🚀 **Quick Start Commands**

```bash
# Install PostgreSQL dependencies
npm install pg

# Set environment variables in Railway dashboard
LOGGER_TYPE=postgresql
DB_HOST=your-postgres-host.railway.internal
DB_PORT=5432
DB_NAME=railway
DB_USER=postgres
DB_PASSWORD=your-password
DB_SSL=true
```

## 📊 **Current Status**

- ❌ **SQLite file** - Will be lost on Railway deployments
- ✅ **Railway PostgreSQL** - Recommended solution
- ⚠️ **Railway Volumes** - Limited support, not recommended for production

## 🆘 **If You Need Help**

1. **Check Railway documentation** for PostgreSQL setup
2. **Verify environment variables** are set correctly
3. **Check deployment logs** for database connection errors
4. **Test locally** with PostgreSQL before deploying

Your data will be safe with Railway PostgreSQL! 🎉
