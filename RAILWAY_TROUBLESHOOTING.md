# Railway PostgreSQL Troubleshooting Guide

## 🚨 **Why Tables Aren't Created in Railway PostgreSQL**

### **Root Causes:**

1. **Environment Variables Not Set** - Most common issue
2. **Migration Not Run** - Tables need to be created manually
3. **Database Connection Issues** - Wrong credentials or SSL settings
4. **Logger Type Not Set** - App defaults to file logging instead of PostgreSQL

## 🔧 **Step-by-Step Fix**

### **Step 1: Verify Railway Environment Variables**

Go to your Railway project dashboard and check these variables:

```bash
# Required for PostgreSQL logging
LOGGER_TYPE=postgresql

# PostgreSQL connection details (Railway provides these)
DB_HOST=your-postgres-host.railway.internal
DB_PORT=5432
DB_NAME=railway
DB_USER=postgres
DB_PASSWORD=your-postgres-password
DB_SSL=true
```

**How to get these values:**
1. Go to your Railway project dashboard
2. Click on your PostgreSQL service
3. Go to "Variables" tab
4. Copy the connection details

### **Step 2: Run Database Migration**

Your app has a migration script that needs to be executed. Run this command in Railway:

```bash
# Option 1: Use the new Railway migration script
npm run migrate

# Option 2: Use the existing Aurora migration script
npm run migrate:aurora
```

**Or run directly:**
```bash
node railway-migrate.js
```

### **Step 3: Verify Tables Were Created**

After running the migration, check if tables exist:

```sql
-- Connect to your Railway PostgreSQL and run:
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

You should see:
- `access_logs` table
- Various views (login_events, daily_stats, etc.)

### **Step 4: Test Your Application**

1. **Check Railway deployment logs** for any database connection errors
2. **Try logging in** to your app - this should create access log entries
3. **Check the admin dashboard** to see if logs are being recorded

## 🐛 **Common Issues & Solutions**

### **Issue 1: "LOGGER_TYPE not set"**
**Error:** App uses file logging instead of PostgreSQL
**Solution:** Set `LOGGER_TYPE=postgresql` in Railway variables

### **Issue 2: "Connection refused"**
**Error:** Can't connect to PostgreSQL
**Solutions:**
- Check `DB_HOST` is correct (should end with `.railway.internal`)
- Verify `DB_PORT=5432`
- Ensure `DB_SSL=true`
- Check if PostgreSQL service is running in Railway

### **Issue 3: "Authentication failed"**
**Error:** Wrong username/password
**Solutions:**
- Copy exact credentials from Railway PostgreSQL service
- Check `DB_USER` and `DB_PASSWORD` are correct
- Ensure no extra spaces in environment variables

### **Issue 4: "Database does not exist"**
**Error:** Wrong database name
**Solutions:**
- Check `DB_NAME` is correct (usually `railway`)
- Verify the database exists in your PostgreSQL service

### **Issue 5: "SSL connection required"**
**Error:** SSL not enabled
**Solutions:**
- Set `DB_SSL=true` in Railway variables
- Ensure SSL is enabled in PostgreSQL service

## 🔍 **Debugging Steps**

### **1. Check Railway Deployment Logs**
```bash
# In Railway dashboard, go to your service
# Click on "Deployments" tab
# Check the latest deployment logs for errors
```

Look for:
- ✅ `"PostgreSQL database initialized"`
- ❌ `"Error initializing database"`
- ❌ `"Connection failed"`

### **2. Test Database Connection**
Create a test script to verify connection:

```javascript
// test-db-connection.js
const { Pool } = require('pg');
require('dotenv').config();

async function testConnection() {
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true'
    });

    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful:', result.rows[0]);
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    } finally {
        await pool.end();
    }
}

testConnection();
```

### **3. Check Table Creation**
```sql
-- Run this in your Railway PostgreSQL console:
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

### **4. Verify App Configuration**
Check your app is using PostgreSQL:

```javascript
// In your Railway deployment logs, look for:
console.log('Logger type:', process.env.LOGGER_TYPE);
console.log('DB Host:', process.env.DB_HOST);
console.log('DB Name:', process.env.DB_NAME);
```

## 🚀 **Quick Fix Commands**

### **If you need to start over:**

1. **Delete and recreate PostgreSQL service in Railway**
2. **Set all environment variables again**
3. **Run migration: `npm run migrate`**
4. **Test with a login attempt**

### **If migration fails:**

```bash
# Check if tables exist
node -e "
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
});
pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \\'public\\'').then(r => console.log(r.rows)).catch(console.error);
"
```

## 📊 **Expected Results**

After successful setup, you should see:

1. **Railway deployment logs:**
   - ✅ `"PostgreSQL database initialized"`
   - ✅ `"Connected to Railway PostgreSQL database"`

2. **Database tables:**
   - `access_logs` table with proper structure
   - Views: `login_events`, `daily_stats`, `hourly_stats`, `user_activity_summary`

3. **Application functionality:**
   - Login attempts are logged to PostgreSQL
   - Admin dashboard shows access logs
   - No more file-based logging

## 🆘 **Still Having Issues?**

1. **Check Railway PostgreSQL service status** - make sure it's running
2. **Verify all environment variables** are set correctly
3. **Run the migration script manually** in Railway console
4. **Check Railway documentation** for PostgreSQL setup
5. **Contact Railway support** if connection issues persist

Your PostgreSQL database should be working after following these steps! 🎉
