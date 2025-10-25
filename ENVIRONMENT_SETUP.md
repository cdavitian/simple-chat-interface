# Environment Variables Setup Guide

This guide shows you how to set up environment variables for local development with the access logging system.

## Step 1: Create Your .env File

Create a `.env` file in your project root directory (same level as `package.json`):

```bash
# In your project root directory
touch .env
```

## Step 2: Copy Environment Variables

Copy the following content into your `.env` file:

```bash
# AWS Cognito Configuration
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_WuzfoISRw
COGNITO_CLIENT_ID=6h307650vrg74mdgc5m182jg99
COGNITO_DOMAIN=https://us-east-1wuzfoisrw.auth.us-east-1.amazoncognito.com

# Session Configuration
SESSION_SECRET=91083034e07905850ded459a261c62f384715b3b3014cc6b01150a324969ff21

# Domain Restriction
ALLOWED_DOMAIN=kyocare.com

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_CHATKIT_WORKFLOW_ID=your_chatkit_workflow_id_here
OPENAI_CHATKIT_PUBLIC_KEY=your_chatkit_public_key_here

# Logging Configuration
LOGGER_TYPE=file
# Options: 'file', 'database', 'aurora'

# File-based Logging (when LOGGER_TYPE=file)
LOG_DIR=./logs
MAX_FILE_SIZE=10485760
MAX_FILES=5

# SQLite Database Logging (when LOGGER_TYPE=database)
DB_PATH=./logs/access.db

# AWS Aurora Database Logging (when LOGGER_TYPE=aurora)
# Uncomment and configure these when using Aurora
# AURORA_DB_TYPE=mysql
# AURORA_HOST=your-aurora-cluster-endpoint.region.rds.amazonaws.com
# AURORA_PORT=3306
# AURORA_DATABASE=access_logs
# AURORA_USERNAME=admin
# AURORA_PASSWORD=your_secure_password
# AURORA_SSL=true
```

## Step 3: Configure Logging Type

Choose your logging method by setting `LOGGER_TYPE`:

### Option 1: File-based Logging (Default - Easiest)
```bash
LOGGER_TYPE=file
```
- **Pros**: Simple setup, no database required
- **Cons**: Limited querying capabilities
- **Best for**: Development, small applications

### Option 2: SQLite Database (Recommended for Development)
```bash
LOGGER_TYPE=database
```
- **Pros**: Better querying, no external dependencies
- **Cons**: Single-file database
- **Best for**: Development, small to medium applications


## Step 4: Install Dependencies

Install the required dependencies based on your logging choice:

```bash
# For file-based logging (no additional dependencies needed)
npm install

# For SQLite database logging
npm install sqlite3

```

## Step 5: Test Your Setup

### Quick Test Script

Create a test file to verify your environment:

```javascript
// test-env.js
require('dotenv').config();

console.log('🔧 Environment Configuration Test');
console.log('================================');

console.log('📊 Logging Type:', process.env.LOGGER_TYPE);
console.log('🏠 AWS Region:', process.env.AWS_REGION);
console.log('🔐 Session Secret:', process.env.SESSION_SECRET ? '✅ Set' : '❌ Missing');
console.log('🌐 Allowed Domain:', process.env.ALLOWED_DOMAIN);


console.log('✅ Environment test completed');
```

Run the test:
```bash
node test-env.js
```

## Step 6: Start Your Application

```bash
# Install dependencies
npm install

# Start the application
npm start
```

## Environment Variables Reference

### Required Variables (Always Needed)
```bash
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_client_id
COGNITO_DOMAIN=your_cognito_domain
SESSION_SECRET=your_secure_session_secret
ALLOWED_DOMAIN=kyocare.com
```

### Logging Configuration
```bash
# Choose one logging method
LOGGER_TYPE=file|database
```

### File-based Logging Variables
```bash
LOG_DIR=./logs
MAX_FILE_SIZE=10485760
MAX_FILES=5
```

### SQLite Database Variables
```bash
DB_PATH=./logs/access.db
```


## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   ```bash
   # Install missing dependencies
   npm install
   ```

2. **"Environment variables not loading"**
   - Ensure `.env` file is in project root
   - Check for typos in variable names
   - Restart your application

3. **"Database connection failed"**
   - Check SQLite database file permissions
   - Ensure logs directory exists and is writable

4. **"Permission denied" errors**
   ```bash
   # Ensure logs directory exists and is writable
   mkdir -p logs
   chmod 755 logs
   ```

### Development vs Production

**Development (.env file):**
```bash
LOGGER_TYPE=file
NODE_ENV=development
```

**Production (Environment variables):**
```bash
LOGGER_TYPE=database
NODE_ENV=production
DB_PATH=./logs/access.db
# ... other production variables
```

## Security Notes

1. **Never commit `.env` files** to version control
2. **Secure database file** with proper file permissions
3. **Backup database** regularly
4. **Rotate secrets** regularly
5. **Use different credentials** for development and production

## Next Steps

1. **Test your setup** with the test script
2. **Choose your logging method** based on your needs
3. **Configure Aurora** if using database logging
4. **Set up monitoring** for production use
5. **Document your configuration** for your team

Your environment is now ready for local development! 🚀

