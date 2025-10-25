# Railway Deployment Checklist

## 🚨 **CRITICAL: Database Persistence on Railway**

**Your current SQLite database will be LOST on every Railway deployment unless you follow these steps.**

## 📋 **Step-by-Step Railway Setup**

### Step 1: Add PostgreSQL Database to Railway

1. **Go to your Railway project dashboard**
2. **Click "New" → "Database" → "PostgreSQL"**
3. **Railway will create a PostgreSQL database**
4. **Note the connection details from the database service**

### Step 2: Set Environment Variables in Railway

Go to your Railway project → Variables tab and add:

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

**Important:** Replace the values with your actual Railway PostgreSQL connection details.

### Step 3: Update Your Code

The code has been updated to support PostgreSQL. You now have:

- ✅ `postgresql-logger.js` - PostgreSQL database logger
- ✅ Updated `logging-config.js` - Supports PostgreSQL
- ✅ Updated `package.json` - Includes `pg` dependency
- ✅ Updated `env.example` - PostgreSQL configuration

### Step 4: Deploy to Railway

1. **Commit your changes:**
   ```bash
   git add .
   git commit -m "Add PostgreSQL support for Railway persistence"
   git push
   ```

2. **Railway will automatically deploy**
3. **Check the deployment logs** for any errors

### Step 5: Verify Database Connection

Check your Railway deployment logs for:
- ✅ `PostgreSQL database initialized`
- ✅ No database connection errors
- ✅ Access logging working

## 🔧 **Alternative: Keep SQLite with Volumes**

If you prefer to keep SQLite, you can use Railway volumes:

### Step 1: Add Volume to Railway

1. **Go to your Railway project**
2. **Click "New" → "Volume"**
3. **Name: "logs"**
4. **Mount path: "/app/logs"**

### Step 2: Update Environment Variables

```bash
LOGGER_TYPE=database
DB_PATH=/app/logs/access.db
```

### Step 3: Update railway.json

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

## 🎯 **Recommended Approach**

**Use PostgreSQL** - it's the most reliable option for Railway:

- ✅ **Persistent** - Data survives deployments
- ✅ **Scalable** - Can handle multiple app instances  
- ✅ **Managed** - Railway handles backups and maintenance
- ✅ **Production-ready** - Suitable for production use

## 🚀 **Quick Commands**

```bash
# Install PostgreSQL dependencies
npm install pg

# Test PostgreSQL locally (if you have PostgreSQL installed)
node test-postgresql.js

# Deploy to Railway
git add .
git commit -m "Add PostgreSQL support"
git push
```

## 📊 **Current Status**

- ❌ **SQLite file** - Will be lost on Railway deployments
- ✅ **PostgreSQL logger** - Ready to use
- ✅ **Railway configuration** - Updated
- ✅ **Environment variables** - Configured

## 🆘 **Troubleshooting**

### Common Issues

1. **"Cannot find module 'pg'"**
   - Run `npm install pg` locally
   - Railway will install it automatically on deployment

2. **"Database connection failed"**
   - Check your Railway PostgreSQL connection details
   - Verify environment variables are set correctly

3. **"Table doesn't exist"**
   - The PostgreSQL logger will create tables automatically
   - Check deployment logs for initialization messages

### Check Railway Logs

1. **Go to your Railway project**
2. **Click on your service**
3. **Go to "Deployments" tab**
4. **Click on the latest deployment**
5. **Check the logs for any errors**

## 🎉 **Success Indicators**

You'll know it's working when you see:

- ✅ `PostgreSQL database initialized` in logs
- ✅ `[ACCESS LOG]` messages in logs
- ✅ No database connection errors
- ✅ Data persists across deployments

## 📞 **Need Help?**

1. **Check Railway documentation** for PostgreSQL setup
2. **Verify environment variables** are set correctly
3. **Check deployment logs** for any errors
4. **Test locally** with PostgreSQL before deploying

Your data will be safe with Railway PostgreSQL! 🎉
