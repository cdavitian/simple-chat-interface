# Deployment Guide: Database Persistence

## 🚨 **CRITICAL: Database Persistence**

Your SQLite database is stored at `./logs/access.db`. **This file will be LOST during most deployments unless you take specific steps.**

## 📋 **Quick Answer to Your Question**

**Will the server instance preserve the database data when redeployed?**

- ❌ **NO** - In most deployment scenarios (Docker, Kubernetes, serverless)
- ✅ **YES** - Only if you use persistent volumes or traditional server deployment

## 🚀 **Deployment Solutions**

### Option 1: Use Backup Script (Recommended)
```bash
# Before deployment
npm run backup

# After deployment (if needed)
npm run backup:restore
```

### Option 2: Persistent Volumes (Docker/Kubernetes)
```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    volumes:
      - ./logs:/app/logs  # This preserves your database
    environment:
      - LOGGER_TYPE=database
      - DB_PATH=./logs/access.db
```

### Option 3: External Database (Production)
For production, consider switching to PostgreSQL or MySQL:

```bash
# Environment variables for external database
LOGGER_TYPE=postgresql
DB_HOST=your-postgres-host
DB_PORT=5432
DB_NAME=access_logs
DB_USER=your-username
DB_PASSWORD=your-password
```

## 🔧 **Pre-Deployment Checklist**

Before deploying:

1. **Backup your database:**
   ```bash
   npm run backup
   ```

2. **Verify backup was created:**
   ```bash
   npm run backup:list
   ```

3. **Check your deployment method:**
   - Docker with volumes? ✅ Data preserved
   - Traditional server? ✅ Data preserved  
   - Serverless/containers without volumes? ❌ Data lost

## 🆘 **If You Lose Data**

1. **Check for backups:**
   ```bash
   npm run backup:list
   ```

2. **Restore from backup:**
   ```bash
   npm run backup:restore
   ```

3. **Accept data loss:** Database will be recreated on next app start

## 📊 **Database File Location**

- **File:** `./logs/access.db`
- **Size:** ~12KB (grows with usage)
- **Backup location:** `./backups/access-{timestamp}.db`

## 🎯 **Recommended Approach**

1. **Development:** Use local SQLite (current setup)
2. **Staging:** Use backup script before deployments
3. **Production:** Consider external database (PostgreSQL/MySQL)

## 🔍 **Testing Persistence**

Test if your deployment preserves data:

```bash
# 1. Create some test data
curl -X POST http://localhost:3000/api/login

# 2. Check database has data
ls -la logs/access.db

# 3. Deploy/restart your app
docker-compose restart

# 4. Verify data still exists
curl http://localhost:3000/api/stats
```

## 📞 **Need Help?**

- Check your hosting provider's documentation
- Verify volume mounting in your deployment config
- Use the backup script before any deployment
- Consider external database for production use
