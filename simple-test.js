// Simple test script that doesn't require dotenv
const fs = require('fs');
const path = require('path');

console.log('🔧 Simple Environment Test');
console.log('==========================');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    console.log('✅ .env file exists');
    
    // Read the .env file content
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // Check for critical variables
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
        const regex = new RegExp(`^${varName}=(.+)`, 'm');
        const match = envContent.match(regex);
        const status = match ? '✅' : '❌';
        const value = match ? match[1] : 'NOT SET';
        
        // Mask sensitive values
        let displayValue = value;
        if (varName.includes('KEY') || varName.includes('SECRET')) {
            displayValue = value.length > 10 ? value.substring(0, 10) + '...' : value;
        }
        
        console.log(`${status} ${varName}: ${displayValue}`);
    });
    
    // Check for placeholder values
    console.log('\n🔍 Placeholder Check:');
    const placeholderVars = [];
    if (envContent.includes('your_openai_api_key_here')) {
        placeholderVars.push('OPENAI_API_KEY');
    }
    if (envContent.includes('your_chatkit_workflow_id_here')) {
        placeholderVars.push('OPENAI_CHATKIT_WORKFLOW_ID');
    }
    if (envContent.includes('your_chatkit_public_key_here')) {
        placeholderVars.push('OPENAI_CHATKIT_PUBLIC_KEY');
    }
    
    if (placeholderVars.length > 0) {
        console.log('⚠️  WARNING: These variables still have placeholder values:');
        placeholderVars.forEach(varName => console.log(`   - ${varName}`));
        console.log('   You need to replace these with your actual credentials!');
    } else {
        console.log('✅ No placeholder values detected');
    }
    
    // Count total lines
    const lines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    console.log(`\n📊 Total environment variables: ${lines.length}`);
    
} else {
    console.log('❌ .env file not found');
}

console.log('\n🎯 Summary:');
console.log('If you see ✅ for all critical variables and no placeholder warnings,');
console.log('your environment setup is complete!');
console.log('\n✅ Test completed');
