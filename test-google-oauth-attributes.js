#!/usr/bin/env node

/**
 * Test script to verify Google OAuth attributes are captured correctly
 * This script simulates a Google OAuth login and checks if all attributes are stored
 */

const LoggingConfig = require('./logging-config');
require('dotenv').config();

async function testGoogleOAuthAttributes() {
    console.log('Testing Google OAuth attributes capture...');
    
    try {
        // Initialize logging config
        const loggingConfig = new LoggingConfig();
        console.log('Logging config initialized:', {
            loggerType: loggingConfig.loggerType,
            loggerInstance: loggingConfig.logger.constructor.name
        });

        // Simulate Google OAuth user info from Cognito
        const mockUserInfo = {
            sub: 'google_oauth_123456789',
            email: 'test.user@kyocare.com',
            email_verified: true,
            family_name: 'Smith',
            given_name: 'John',
            name: 'John Smith',
            picture: 'https://lh3.googleusercontent.com/a/default-user-photo.jpg'
        };

        console.log('Mock user info from Google OAuth:', mockUserInfo);

        // Test access logging with Google OAuth attributes
        const testEvent = {
            userId: mockUserInfo.sub,
            email: mockUserInfo.email,
            eventType: 'login',
            ipAddress: '192.168.1.100',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            sessionId: 'test_session_123',
            // Google OAuth attributes from Cognito
            emailVerified: mockUserInfo.email_verified,
            familyName: mockUserInfo.family_name,
            givenName: mockUserInfo.given_name,
            fullName: mockUserInfo.name,
            pictureUrl: mockUserInfo.picture,
            username: mockUserInfo.sub, // username is mapped from sub in Cognito
            metadata: {
                authMethod: 'cognito_google_oauth',
                domain: 'kyocare.com',
                isProduction: false,
                testRun: true
            }
        };

        console.log('Logging test event with Google OAuth attributes...');
        await loggingConfig.logAccess(testEvent);
        console.log('✅ Test event logged successfully');

        // Query the logged event to verify attributes were stored
        console.log('Querying logged event to verify attributes...');
        const logs = await loggingConfig.queryUserLogs(mockUserInfo.sub, null, null, 1);
        
        if (logs.length > 0) {
            const logEntry = logs[0];
            console.log('Retrieved log entry:', {
                userId: logEntry.user_id,
                email: logEntry.email,
                eventType: logEntry.event_type,
                emailVerified: logEntry.email_verified,
                familyName: logEntry.family_name,
                givenName: logEntry.given_name,
                fullName: logEntry.full_name,
                pictureUrl: logEntry.picture_url,
                username: logEntry.username,
                metadata: logEntry.metadata
            });

            // Verify all Google OAuth attributes are present
            const attributes = {
                emailVerified: logEntry.email_verified,
                familyName: logEntry.family_name,
                givenName: logEntry.given_name,
                fullName: logEntry.full_name,
                pictureUrl: logEntry.picture_url,
                username: logEntry.username
            };

            console.log('\n🔍 Verifying Google OAuth attributes:');
            let allAttributesPresent = true;

            Object.entries(attributes).forEach(([key, value]) => {
                const isPresent = value !== null && value !== undefined;
                console.log(`  ${key}: ${isPresent ? '✅' : '❌'} ${value || 'NULL'}`);
                if (!isPresent) allAttributesPresent = false;
            });

            if (allAttributesPresent) {
                console.log('\n🎉 SUCCESS: All Google OAuth attributes are being captured and stored correctly!');
            } else {
                console.log('\n⚠️  WARNING: Some Google OAuth attributes are missing or null');
            }

            // Test metadata parsing
            if (logEntry.metadata) {
                const metadata = typeof logEntry.metadata === 'string' 
                    ? JSON.parse(logEntry.metadata) 
                    : logEntry.metadata;
                console.log('\n📋 Metadata verification:');
                console.log(`  authMethod: ${metadata.authMethod || 'MISSING'}`);
                console.log(`  domain: ${metadata.domain || 'MISSING'}`);
                console.log(`  testRun: ${metadata.testRun || 'MISSING'}`);
            }

        } else {
            console.log('❌ No log entries found for test user');
        }

        // Test querying all recent logs to see the new attributes
        console.log('\n📊 Testing recent logs query...');
        const recentLogs = await loggingConfig.getAllUsers();
        console.log(`Found ${recentLogs.length} total user entries`);
        
        if (recentLogs.length > 0) {
            console.log('Sample user entry:', recentLogs[0]);
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            detail: error.detail
        });
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    testGoogleOAuthAttributes().catch(console.error);
}

module.exports = testGoogleOAuthAttributes;
