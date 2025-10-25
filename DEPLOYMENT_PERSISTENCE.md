# Database Persistence Guide

This guide explains how to ensure your SQLite database persists across deployments.

## 🚨 Important: Database File Location

Your SQLite database is stored at: `./logs/access.db`

**This file MUST be preserved during deployments to maintain your data.**

## 📋 Deployment Scenarios

### ✅ **Data WILL Persist**

#### 1. Traditional VPS/Server Deployment
```bash
# Your app runs on a persistent server
# Database file stays in ./logs/access.db
# Data persists across app restarts
```

#### 2. Docker with Persistent Volume
```dockerfile
# Dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./logs:/app/logs  # Mount persistent volume
    environment:
      - LOGGER_TYPE=database
      - DB_PATH=./logs/access.db
```

#### 3. Kubernetes with Persistent Volume
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: logs-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chat-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chat-app
  template:
    metadata:
      labels:
        app: chat-app
    spec:
      containers:
      - name: chat-app
        image: your-app:latest
        volumeMounts:
        - name: logs-storage
          mountPath: /app/logs
      volumes:
      - name: logs-storage
        persistentVolumeClaim:
          claimName: logs-pvc
```

### ❌ **Data Will NOT Persist**

#### 1. Serverless Functions (AWS Lambda, Vercel, Netlify)
- Ephemeral file system
- Database file is lost after each execution
- **Solution**: Use external database (PostgreSQL, MySQL, etc.)

#### 2. Docker without Volume Mounting
```bash
# BAD - Data will be lost
docker run your-app:latest
```

#### 3. Stateless Container Orchestration
- Without persistent volume configuration
- Each container restart creates fresh file system

## 🔧 **Recommended Solutions**

### Option 1: External Database (Recommended for Production)
Switch to a managed database service:

```bash
# PostgreSQL example
LOGGER_TYPE=postgresql
DB_HOST=your-postgres-host
DB_PORT=5432
DB_NAME=access_logs
DB_USER=your-username
DB_PASSWORD=your-password
```

### Option 2: Database Backup Strategy
Create automated backups:

```javascript
// backup-script.js
const fs = require('fs');
const path = require('path');

function backupDatabase() {
    const source = './logs/access.db';
    const backup = `./backups/access-${Date.now()}.db`;
    
    if (fs.existsSync(source)) {
        fs.copyFileSync(source, backup);
        console.log(`Database backed up to ${backup}`);
    }
}

// Run before deployment
backupDatabase();
```

### Option 3: Cloud Storage Integration
Store database in cloud storage:

```javascript
// cloud-storage-logger.js
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

class CloudStorageLogger {
    async downloadDatabase() {
        // Download from S3 before starting
        const params = { Bucket: 'your-bucket', Key: 'access.db' };
        const data = await s3.getObject(params).promise();
        fs.writeFileSync('./logs/access.db', data.Body);
    }
    
    async uploadDatabase() {
        // Upload to S3 before shutdown
        const fileContent = fs.readFileSync('./logs/access.db');
        const params = {
            Bucket: 'your-bucket',
            Key: 'access.db',
            Body: fileContent
        };
        await s3.putObject(params).promise();
    }
}
```

## 🚀 **Deployment Checklist**

Before deploying, verify:

- [ ] **Database file location**: `./logs/access.db`
- [ ] **Volume mounting**: Persistent storage mounted to `./logs/`
- [ ] **Backup strategy**: Regular backups configured
- [ ] **Environment variables**: `LOGGER_TYPE=database` and `DB_PATH=./logs/access.db`
- [ ] **File permissions**: App can read/write to database file

## 🔍 **Testing Persistence**

Test your deployment:

```bash
# 1. Deploy and create some data
curl -X POST http://your-app/login
# Check database has data

# 2. Restart/redeploy
docker-compose restart
# or
kubectl rollout restart deployment/your-app

# 3. Verify data still exists
curl http://your-app/stats
# Should show previous data
```

## ⚠️ **Production Recommendations**

For production applications, consider:

1. **External Database**: PostgreSQL, MySQL, or MongoDB
2. **Managed Services**: AWS RDS, Google Cloud SQL, Azure Database
3. **Backup Strategy**: Automated daily backups
4. **Monitoring**: Database health and performance monitoring
5. **Scaling**: Multiple app instances can share external database

## 🆘 **Emergency Recovery**

If you lose your database:

1. **Check backups**: Look for `./backups/` directory
2. **Check logs**: Access logs might be in file format
3. **Recreate**: Database will be recreated on next app start
4. **Data loss**: Accept that historical data is lost

## 📞 **Need Help?**

If you're unsure about your deployment setup, check:
- Your hosting provider's documentation
- Container orchestration platform docs
- Database backup and recovery procedures
