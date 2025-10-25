// Simple environment check without complex regex
const fs = require('fs');
const path = require('path');

console.log('🔧 Environment Check');
console.log('===================');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    console.log('✅ .env file exists');
    
    // Read the .env file content
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    console.log(`📊 Total lines in .env file: ${lines.length}`);
    
    // Check for critical variables using simple string matching
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
        const line = lines.find(l => l.startsWith(varName + '='));
        if (line) {
            const value = line.split('=')[1] || '';
            let displayValue = value;
            
            // Mask sensitive values
            if (varName.includes('KEY') || varName.includes('SECRET')) {
                displayValue = value.length > 10 ? value.substring(0, 10) + '...' : value;
            }
            
            console.log(`✅ ${varName}: ${displayValue}`);
        } else {
            console.log(`❌ ${varName}: NOT SET`);
        }
    });
    
    // Check for placeholder values
    console.log('\n🔍 Placeholder Check:');
    const placeholderChecks = [
        { name: 'OPENAI_API_KEY', placeholder: 'your_openai_api_key_here' },
        { name: 'OPENAI_CHATKIT_WORKFLOW_ID', placeholder: 'your_chatkit_workflow_id_here' },
        { name: 'OPENAI_CHATKIT_PUBLIC_KEY', placeholder: 'your_chatkit_public_key_here' }
    ];
    
    let hasPlaceholders = false;
    placeholderChecks.forEach(check => {
        if (envContent.includes(check.placeholder)) {
            console.log(`⚠️  ${check.name} still has placeholder value`);
            hasPlaceholders = true;
        }
    });
    
    if (!hasPlaceholders) {
        console.log('✅ No placeholder values detected');
    }
    
    // Count non-comment, non-empty lines
    const configLines = lines.filter(line => 
        line.trim() && 
        !line.startsWith('#') && 
        line.includes('=')
    );
    console.log(`\n📈 Environment variables configured: ${configLines.length}`);
    
} else {
    console.log('❌ .env file not found');
}

console.log('\n🎯 Summary:');
console.log('If you see ✅ for all critical variables and no placeholder warnings,');
console.log('your environment setup is complete!');
console.log('\n✅ Check completed');
