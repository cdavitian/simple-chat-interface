# AWS Aurora Database Setup for Access Logging

This guide will help you set up AWS Aurora for storing access logs in your chat interface application.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured (optional, for easier management)
- Node.js application with the logging system installed

## Step 1: Create Aurora Cluster

### Option A: Using AWS Console

1. **Navigate to RDS Console**
   - Go to AWS RDS service
   - Click "Create database"

2. **Choose Engine**
   - **For MySQL**: Select "Amazon Aurora MySQL"
   - **For PostgreSQL**: Select "Amazon Aurora PostgreSQL"

3. **Configure Cluster**
   - **Cluster identifier**: `access-logs-cluster`
   - **Master username**: `admin` (or your preferred username)
   - **Master password**: Generate a secure password
   - **DB instance class**: `db.t3.medium` (adjust based on needs)
   - **Storage**: Aurora storage (auto-scaling)

4. **Network & Security**
   - **VPC**: Choose your application's VPC
   - **Subnet group**: Default or create new
   - **Public access**: No (recommended for security)
   - **VPC security groups**: Create new or use existing

5. **Database Options**
   - **Initial database name**: `access_logs`
   - **Backup retention**: 7 days (adjust as needed)
   - **Monitoring**: Enable Performance Insights

### Option B: Using AWS CLI

```bash
# For MySQL Aurora
aws rds create-db-cluster \
    --db-cluster-identifier access-logs-cluster \
    --engine aurora-mysql \
    --engine-version 8.0.mysql_aurora.3.02.0 \
    --master-username admin \
    --master-user-password YourSecurePassword123! \
    --database-name access_logs \
    --backup-retention-period 7 \
    --preferred-backup-window "03:00-04:00" \
    --preferred-maintenance-window "sun:04:00-sun:05:00"

# Create DB instance
aws rds create-db-instance \
    --db-instance-identifier access-logs-instance \
    --db-cluster-identifier access-logs-cluster \
    --db-instance-class db.t3.medium \
    --engine aurora-mysql
```

## Step 2: Configure Security Groups

1. **Create Security Group**
   - Name: `aurora-access-logs-sg`
   - Description: `Security group for Aurora access logs`

2. **Add Inbound Rules**
   - **Type**: MySQL/Aurora (port 3306) or PostgreSQL (port 5432)
   - **Source**: Your application's security group or specific IP
   - **Description**: `Allow access from application`

## Step 3: Get Connection Details

After creating the cluster, note down:

- **Endpoint**: `access-logs-cluster.cluster-xxxxx.region.rds.amazonaws.com`
- **Port**: 3306 (MySQL) or 5432 (PostgreSQL)
- **Database name**: `access_logs`
- **Username**: `admin` (or your chosen username)
- **Password**: The password you set

## Step 4: Update Environment Variables

Update your `.env` file:

```bash
# Logging Configuration
LOGGER_TYPE=aurora

# AWS Aurora Database Configuration
AURORA_DB_TYPE=mysql
# Options: 'mysql', 'postgresql'

AURORA_HOST=access-logs-cluster.cluster-xxxxx.region.rds.amazonaws.com
AURORA_PORT=3306
AURORA_DATABASE=access_logs
AURORA_USERNAME=admin
AURORA_PASSWORD=YourSecurePassword123!
AURORA_SSL=true
```

## Step 5: Install Dependencies

```bash
# Install required database drivers
npm install mysql2 pg

# For development, you might also want:
npm install --save-dev @types/mysql2 @types/pg
```

## Step 6: Run Database Migration

```bash
# Run the migration script
node database/migrate.js
```

This will:
- Connect to your Aurora cluster
- Create the necessary tables and indexes
- Set up views for analytics
- Create stored procedures/functions

## Step 7: Test the Connection

Create a test script to verify everything works:

```javascript
// test-aurora.js
const AuroraLogger = require('./aurora-logger');
require('dotenv').config();

async function testAurora() {
    const logger = new AuroraLogger({
        dbType: process.env.AURORA_DB_TYPE,
        host: process.env.AURORA_HOST,
        port: process.env.AURORA_PORT,
        database: process.env.AURORA_DATABASE,
        username: process.env.AURORA_USERNAME,
        password: process.env.AURORA_PASSWORD,
        ssl: process.env.AURORA_SSL === 'true',
        enableConsole: true
    });

    try {
        // Test connection
        const connected = await logger.testConnection();
        console.log('Connection test:', connected ? '✅ Passed' : '❌ Failed');
        
        // Test logging
        await logger.logAccess({
            userId: 'test@kyocare.com',
            email: 'test@kyocare.com',
            eventType: 'login',
            ipAddress: '192.168.1.100',
            userAgent: 'Test User Agent',
            sessionId: 'test-session-123',
            metadata: { test: true }
        });
        console.log('✅ Test log entry created');
        
        // Test querying
        const logs = await logger.queryUserLogs('test@kyocare.com');
        console.log('✅ Query test passed, found', logs.length, 'entries');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await logger.close();
    }
}

testAurora();
```

Run the test:
```bash
node test-aurora.js
```

## Step 8: Update Your Application

Your application is already configured to use Aurora when `LOGGER_TYPE=aurora`. Just restart your server:

```bash
npm start
```

## Database Schema Overview

The migration creates the following:

### Tables
- **`access_logs`**: Main table storing all access events
- **Indexes**: Optimized for common queries (user_id, timestamp, event_type)

### Views
- **`login_events`**: Filtered view of login events only
- **`daily_stats`**: Daily statistics aggregation
- **`hourly_stats`**: Hourly distribution of events
- **`user_activity_summary`**: Per-user activity summary

### Functions/Procedures
- **`CleanupOldLogs()`**: MySQL stored procedure for cleanup
- **`cleanup_old_logs()`**: PostgreSQL function for cleanup
- **`GetUserLoginCount()`**: MySQL function for user login counts
- **`get_user_login_count()`**: PostgreSQL function for user login counts

## Monitoring and Maintenance

### CloudWatch Metrics
Monitor these key metrics:
- **DatabaseConnections**: Number of active connections
- **CPUUtilization**: CPU usage
- **FreeableMemory**: Available memory
- **ReadLatency/WriteLatency**: Database performance

### Automated Cleanup
Set up a scheduled task to clean old logs:

```javascript
// cleanup-script.js
const AuroraLogger = require('./aurora-logger');
require('dotenv').config();

async function cleanupOldLogs() {
    const logger = new AuroraLogger({
        dbType: process.env.AURORA_DB_TYPE,
        host: process.env.AURORA_HOST,
        port: process.env.AURORA_PORT,
        database: process.env.AURORA_DATABASE,
        username: process.env.AURORA_USERNAME,
        password: process.env.AURORA_PASSWORD,
        ssl: process.env.AURORA_SSL === 'true'
    });

    try {
        const deletedCount = await logger.cleanupOldLogs(30); // Keep 30 days
        console.log(`Cleaned up ${deletedCount} old log entries`);
    } catch (error) {
        console.error('Cleanup failed:', error.message);
    } finally {
        await logger.close();
    }
}

cleanupOldLogs();
```

### Backup Strategy
- **Automated Backups**: Aurora handles this automatically
- **Point-in-time Recovery**: Available for up to 35 days
- **Manual Snapshots**: Create before major changes

## Security Best Practices

1. **Network Security**
   - Use private subnets
   - Restrict security group access
   - Enable SSL/TLS connections

2. **Access Control**
   - Use IAM database authentication
   - Implement least privilege access
   - Rotate passwords regularly

3. **Data Protection**
   - Enable encryption at rest
   - Use SSL for connections
   - Implement data retention policies

## Troubleshooting

### Common Issues

1. **Connection Timeout**
   - Check security group rules
   - Verify VPC configuration
   - Ensure Aurora cluster is running

2. **Authentication Failed**
   - Verify username/password
   - Check database name
   - Ensure user has proper permissions

3. **SSL Certificate Issues**
   - Download AWS RDS CA certificate
   - Configure SSL properly in connection

### Debug Mode
Enable detailed logging:

```bash
DEBUG=aurora:* npm start
```

## Cost Optimization

1. **Right-size Instances**: Start with smaller instances and scale up
2. **Storage Optimization**: Use Aurora's auto-scaling storage
3. **Backup Retention**: Adjust retention period based on needs
4. **Monitoring**: Set up billing alerts

## Scaling Considerations

- **Read Replicas**: Add for read-heavy workloads
- **Aurora Serverless**: For variable workloads
- **Multi-AZ**: For high availability
- **Global Database**: For multi-region deployments

## Next Steps

1. **Set up monitoring** with CloudWatch
2. **Configure alerts** for critical metrics
3. **Implement backup strategy**
4. **Set up log rotation** and cleanup
5. **Test failover** scenarios
6. **Document procedures** for your team

Your Aurora setup is now ready for production use! 🎉

