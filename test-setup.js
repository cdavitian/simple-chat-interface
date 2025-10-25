// Test script to verify environment setup
require('dotenv').config();

console.log('🔧 Environment Setup Test');
console.log('==========================');

// Check critical variables
const criticalVars = [
    'OPENAI_API_KEY',
    'OPENAI_CHATKIT_WORKFLOW_ID', 
    'OPENAI_CHATKIT_PUBLIC_KEY',
    'SESSION_SECRET',
    'ALLOWED_DOMAIN',
    'LOGGER_TYPE'
];

console.log('\n📋 Critical Variables Check:');
criticalVars.forEach(varName => {
    const value = process.env[varName];
    const status = value ? '✅' : '❌';
    const displayValue = value ? 
        (varName.includes('KEY') || varName.includes('SECRET') ? 
            value.substring(0, 10) + '...' : value) : 
        'NOT SET';
    console.log(`${status} ${varName}: ${displayValue}`);
});

// Check OpenAI configuration specifically
console.log('\n🤖 OpenAI Configuration:');
console.log(`API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`Workflow ID: ${process.env.OPENAI_CHATKIT_WORKFLOW_ID ? '✅ Set' : '❌ Missing'}`);
console.log(`Public Key: ${process.env.OPENAI_CHATKIT_PUBLIC_KEY ? '✅ Set' : '❌ Missing'}`);

// Check logging configuration
console.log('\n📊 Logging Configuration:');
console.log(`Logger Type: ${process.env.LOGGER_TYPE || 'NOT SET'}`);

if (process.env.LOGGER_TYPE === 'file') {
    console.log(`Log Directory: ${process.env.LOG_DIR || './logs'}`);
    console.log(`Max File Size: ${process.env.MAX_FILE_SIZE || '10485760'}`);
    console.log(`Max Files: ${process.env.MAX_FILES || '5'}`);
} else if (process.env.LOGGER_TYPE === 'database') {
    console.log(`Database Path: ${process.env.DB_PATH || './logs/access.db'}`);
} else if (process.env.LOGGER_TYPE === 'aurora') {
    console.log(`Aurora Host: ${process.env.AURORA_HOST || 'NOT SET'}`);
    console.log(`Aurora Database: ${process.env.AURORA_DATABASE || 'NOT SET'}`);
}

// Check if values are placeholders
console.log('\n🔍 Placeholder Check:');
const placeholderVars = [];
if (process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    placeholderVars.push('OPENAI_API_KEY');
}
if (process.env.OPENAI_CHATKIT_WORKFLOW_ID === 'your_chatkit_workflow_id_here') {
    placeholderVars.push('OPENAI_CHATKIT_WORKFLOW_ID');
}
if (process.env.OPENAI_CHATKIT_PUBLIC_KEY === 'your_chatkit_public_key_here') {
    placeholderVars.push('OPENAI_CHATKIT_PUBLIC_KEY');
}

if (placeholderVars.length > 0) {
    console.log('⚠️  WARNING: These variables still have placeholder values:');
    placeholderVars.forEach(varName => console.log(`   - ${varName}`));
    console.log('   You need to replace these with your actual credentials!');
} else {
    console.log('✅ No placeholder values detected');
}

console.log('\n🎯 Summary:');
const hasAllCritical = criticalVars.every(varName => process.env[varName]);
const hasNoPlaceholders = placeholderVars.length === 0;

if (hasAllCritical && hasNoPlaceholders) {
    console.log('🎉 Your environment setup is COMPLETE!');
    console.log('   You can now run: npm start');
} else if (hasAllCritical) {
    console.log('⚠️  Environment variables are set but some are still placeholders');
    console.log('   Replace placeholder values with real credentials');
} else {
    console.log('❌ Some critical environment variables are missing');
    console.log('   Check your .env file and ensure all variables are set');
}

console.log('\n✅ Test completed');
