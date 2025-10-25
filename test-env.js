#!/usr/bin/env node

/**
 * Environment Configuration Test Script
 * 
 * This script tests your environment variables and logging configuration.
 * Run this to verify your setup before starting the application.
 * 
 * Usage: node test-env.js
 */

require('dotenv').config();

console.log('🔧 Environment Configuration Test');
console.log('================================');

// Test basic configuration
console.log('\n📋 Basic Configuration:');
console.log('  AWS Region:', process.env.AWS_REGION || '❌ Missing');
console.log('  Cognito User Pool ID:', process.env.COGNITO_USER_POOL_ID ? '✅ Set' : '❌ Missing');
console.log('  Cognito Client ID:', process.env.COGNITO_CLIENT_ID ? '✅ Set' : '❌ Missing');
console.log('  Cognito Domain:', process.env.COGNITO_DOMAIN || '❌ Missing');
console.log('  Session Secret:', process.env.SESSION_SECRET ? '✅ Set' : '❌ Missing');
console.log('  Allowed Domain:', process.env.ALLOWED_DOMAIN || '❌ Missing');

// Test logging configuration
console.log('\n📊 Logging Configuration:');
const loggerType = process.env.LOGGER_TYPE || 'file';
console.log('  Logger Type:', loggerType);

switch (loggerType) {
    case 'file':
        console.log('  Log Directory:', process.env.LOG_DIR || './logs');
        console.log('  Max File Size:', process.env.MAX_FILE_SIZE || '10485760');
        console.log('  Max Files:', process.env.MAX_FILES || '5');
        break;
        
    case 'database':
        console.log('  Database Path:', process.env.DB_PATH || './logs/access.db');
        break;
        
    case 'aurora':
        console.log('  Aurora DB Type:', process.env.AURORA_DB_TYPE || '❌ Missing');
        console.log('  Aurora Host:', process.env.AURORA_HOST || '❌ Missing');
        console.log('  Aurora Port:', process.env.AURORA_PORT || '❌ Missing');
        console.log('  Aurora Database:', process.env.AURORA_DATABASE || '❌ Missing');
        console.log('  Aurora Username:', process.env.AURORA_USERNAME || '❌ Missing');
        console.log('  Aurora Password:', process.env.AURORA_PASSWORD ? '✅ Set' : '❌ Missing');
        console.log('  Aurora SSL:', process.env.AURORA_SSL || 'false');
        break;
}

// Test OpenAI configuration
console.log('\n🤖 OpenAI Configuration:');
console.log('  API Key:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
console.log('  ChatKit Workflow ID:', process.env.OPENAI_CHATKIT_WORKFLOW_ID ? '✅ Set' : '❌ Missing');
console.log('  ChatKit Public Key:', process.env.OPENAI_CHATKIT_PUBLIC_KEY ? '✅ Set' : '❌ Missing');

// Test logging system
console.log('\n🧪 Testing Logging System:');

try {
    const LoggingConfig = require('./logging-config');
    const loggingConfig = new LoggingConfig();
    const logger = loggingConfig.getLogger();
    
    console.log('  ✅ Logging system initialized successfully');
    console.log('  📝 Logger type:', logger.constructor.name);
    
    // Test logging a sample event
    if (typeof logger.logAccess === 'function') {
        logger.logAccess({
            userId: 'test@kyocare.com',
            email: 'test@kyocare.com',
            eventType: 'test',
            ipAddress: '127.0.0.1',
            userAgent: 'Test Script',
            sessionId: 'test-session',
            metadata: { test: true }
        });
        console.log('  ✅ Test log entry created successfully');
    }
    
} catch (error) {
    console.log('  ❌ Logging system initialization failed:', error.message);
}

// Test database connection (if using Aurora)
if (loggerType === 'aurora') {
    console.log('\n🗄️  Testing Aurora Connection:');
    
    try {
        const AuroraLogger = require('./aurora-logger');
        const auroraLogger = new AuroraLogger({
            dbType: process.env.AURORA_DB_TYPE,
            host: process.env.AURORA_HOST,
            port: process.env.AURORA_PORT,
            database: process.env.AURORA_DATABASE,
            username: process.env.AURORA_USERNAME,
            password: process.env.AURORA_PASSWORD,
            ssl: process.env.AURORA_SSL === 'true',
            enableConsole: false
        });
        
        // Test connection asynchronously
        auroraLogger.testConnection().then(connected => {
            if (connected) {
                console.log('  ✅ Aurora connection test passed');
            } else {
                console.log('  ❌ Aurora connection test failed');
            }
            auroraLogger.close();
        }).catch(error => {
            console.log('  ❌ Aurora connection test failed:', error.message);
        });
        
    } catch (error) {
        console.log('  ❌ Aurora logger initialization failed:', error.message);
    }
}

// Summary
console.log('\n📋 Summary:');
const requiredVars = [
    'AWS_REGION',
    'COGNITO_USER_POOL_ID', 
    'COGNITO_CLIENT_ID',
    'COGNITO_DOMAIN',
    'SESSION_SECRET',
    'ALLOWED_DOMAIN'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length === 0) {
    console.log('  ✅ All required environment variables are set');
} else {
    console.log('  ❌ Missing required variables:', missingVars.join(', '));
}

if (loggerType === 'aurora') {
    const auroraVars = ['AURORA_HOST', 'AURORA_DATABASE', 'AURORA_USERNAME', 'AURORA_PASSWORD'];
    const missingAuroraVars = auroraVars.filter(varName => !process.env[varName]);
    
    if (missingAuroraVars.length === 0) {
        console.log('  ✅ All Aurora configuration variables are set');
    } else {
        console.log('  ❌ Missing Aurora variables:', missingAuroraVars.join(', '));
    }
}

console.log('\n🚀 Environment test completed!');
console.log('💡 Next steps:');
console.log('   1. Fix any missing variables above');
console.log('   2. Run: npm start');
console.log('   3. Visit: http://localhost:3000');

