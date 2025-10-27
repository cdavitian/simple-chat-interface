const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const AWS = require('aws-sdk');
const OpenAI = require('openai');
const crypto = require('crypto');
const LoggingConfig = require('./logging-config');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize access logger
const loggingConfig = new LoggingConfig();
const accessLogger = loggingConfig.getLogger();

// Run database migration for Google OAuth attributes
const runMigration = async () => {
    try {
        console.log('Checking for Google OAuth attributes migration...');
        
        // Check if the new columns exist
        const checkColumnsSQL = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'access_logs' 
            AND column_name IN ('email_verified', 'family_name', 'given_name', 'full_name', 'picture_url', 'username')
        `;
        
        const existingColumns = await loggingConfig.logger.pool.query(checkColumnsSQL);
        const existingColumnNames = existingColumns.rows.map(row => row.column_name);
        
        if (existingColumnNames.length < 6) {
            console.log('Google OAuth columns missing, running migration...');
            
            // Add missing columns
            const addColumnsSQL = `
                ALTER TABLE access_logs 
                ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS family_name VARCHAR(255) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS given_name VARCHAR(255) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS picture_url VARCHAR(500) DEFAULT NULL,
                ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT NULL
            `;

            await loggingConfig.logger.pool.query(addColumnsSQL);
            console.log('✅ Google OAuth columns added successfully');

            // Add indexes for the new columns
            const indexSQL = [
                'CREATE INDEX IF NOT EXISTS idx_access_logs_email_verified ON access_logs(email_verified)',
                'CREATE INDEX IF NOT EXISTS idx_access_logs_username ON access_logs(username)'
            ];

            for (const sql of indexSQL) {
                try {
                    await loggingConfig.logger.pool.query(sql);
                } catch (error) {
                    console.warn(`Warning: Could not create index: ${sql}`, error.message);
                }
            }
            
            console.log('✅ Google OAuth migration completed successfully');
        } else {
            console.log('✅ Google OAuth columns already exist, migration not needed');
        }
    } catch (error) {
        console.error('Migration check failed:', error.message);
        // Don't fail the app startup if migration fails
    }
};

// Run migration on startup
runMigration();

// Configure AWS
AWS.config.update({
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Lazy OpenAI client initialization - only create when needed
let openaiClient = null;
const getOpenAIClient = () => {
    if (!openaiClient && process.env.OPENAI_API_KEY) {
        openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    return openaiClient;
};

// Session configuration
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

// Trust proxy - required for Railway/Heroku/etc (they use reverse proxies)
if (isProduction) {
    app.set('trust proxy', 1);
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, // true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax' // Allow cookies for same-site requests
    },
    proxy: isProduction // Trust the reverse proxy when setting secure cookies
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration - only needed if frontend is on different domain
// For same-origin, we don't need CORS at all
// app.use(cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:3000',
//     credentials: true
// }));

// Helper function to extract client information
const getClientInfo = (req) => {
    return {
        ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown'
    };
};

// Helper function to calculate SECRET_HASH for Cognito
const calculateSecretHash = (username, clientId, clientSecret) => {
    return crypto
        .createHmac('SHA256', clientSecret)
        .update(username + clientId)
        .digest('base64');
};

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    res.status(401).json({ error: 'Authentication required' });
};

// Serve static files from public directory (avatars, etc)
app.use('/public', express.static('public'));

// Serve styles.css from root for login page
app.use('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

// ============ Authentication Routes ============

// AWS Cognito Hosted UI Routes for Google OAuth
app.get('/auth/cognito', (req, res) => {
    const cognitoDomain = process.env.COGNITO_HOSTED_UI_DOMAIN;
    const clientId = process.env.COGNITO_CLIENT_ID;
    const redirectUri = process.env.COGNITO_REDIRECT_URI;
    
    if (!cognitoDomain || !clientId || !redirectUri) {
        console.error('Missing Cognito configuration for Google OAuth');
        return res.status(500).json({ error: 'OAuth configuration missing' });
    }
    
    const authUrl = `https://${cognitoDomain}/oauth2/authorize?` +
        `client_id=${clientId}&` +
        `response_type=code&` +
        `scope=email+openid+profile&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    console.log('Redirecting to Cognito OAuth:', authUrl);
    res.redirect(authUrl);
});

app.get('/auth/cognito/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            console.error('No authorization code received');
            return res.redirect('/login?error=no_code');
        }
        
        console.log('Received authorization code:', code.substring(0, 10) + '...');
        
        // Exchange code for tokens
        const tokenResponse = await fetch(`https://${process.env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.COGNITO_CLIENT_ID,
                client_secret: process.env.COGNITO_CLIENT_SECRET,
                code: code,
                redirect_uri: process.env.COGNITO_REDIRECT_URI,
            }),
        });
        
        const tokens = await tokenResponse.json();
        
        if (tokens.error) {
            console.error('Token exchange failed:', tokens);
            return res.redirect('/login?error=token_exchange_failed');
        }
        
        console.log('Token exchange successful');
        
        // Get user info from Cognito
        const userResponse = await fetch(`https://${process.env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/userInfo`, {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
            },
        });
        
        const userInfo = await userResponse.json();
        
        if (userInfo.error) {
            console.error('Failed to get user info:', userInfo);
            return res.redirect('/login?error=user_info_failed');
        }
        
        console.log('User info received:', { email: userInfo.email, name: userInfo.name });
        
        // Check domain restriction
        const email = userInfo.email;
        const domain = email.split('@')[1];
        
        if (domain !== 'kyocare.com') {
            console.log('Domain restriction failed for:', domain);
            return res.redirect('/login?error=access_denied');
        }
        
        // Store user in session
        req.session.user = {
            id: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name,
            avatar: userInfo.picture,
            // Additional Google OAuth attributes
            emailVerified: userInfo.email_verified,
            familyName: userInfo.family_name,
            givenName: userInfo.given_name,
            username: userInfo.sub // username is mapped from sub in Cognito
        };
        
        // Log successful login
        const clientInfo = getClientInfo(req);
        console.log('Attempting to log access for Google OAuth login:', {
            userId: req.session.user.id,
            email: req.session.user.email,
            eventType: 'login',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID
        });
        
        try {
            await loggingConfig.logAccess({
                userId: req.session.user.id,
                email: req.session.user.email,
                eventType: 'login',
                ipAddress: clientInfo.ipAddress,
                userAgent: clientInfo.userAgent,
                sessionId: req.sessionID,
                // Google OAuth attributes from Cognito
                emailVerified: userInfo.email_verified,
                familyName: userInfo.family_name,
                givenName: userInfo.given_name,
                fullName: userInfo.name,
                pictureUrl: userInfo.picture,
                username: userInfo.sub,
                metadata: {
                    authMethod: 'cognito_google_oauth',
                    domain: domain,
                    isProduction: isProduction
                }
            });
            console.log('Access log entry created successfully for Google OAuth login');
        } catch (logError) {
            console.error('Failed to log access for Google OAuth login:', logError);
        }
        
        console.log('Google OAuth login successful for:', userInfo.email);
        res.redirect('/');
        
    } catch (error) {
        console.error('Cognito OAuth callback error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('Traditional login attempt for:', email);
        console.log('AWS Config check:', {
            region: process.env.AWS_REGION,
            hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
            hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
            userPoolId: process.env.COGNITO_USER_POOL_ID,
            clientId: process.env.COGNITO_CLIENT_ID
        });
        
        // Check if email domain is kyocare.com
        const domain = email.split('@')[1];
        if (domain !== 'kyocare.com') {
            return res.status(403).json({ 
                error: 'Access denied. Only kyocare.com users are allowed.' 
            });
        }
        
        // Check AWS credentials
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            console.error('AWS credentials not configured');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        
        // Check if client secret is configured (required for SECRET_HASH)
        if (!process.env.COGNITO_CLIENT_SECRET) {
            console.error('Cognito client secret not configured');
            return res.status(500).json({ error: 'Server configuration error - missing client secret' });
        }
        
        // Use AWS Cognito for authentication
        const AWS = require('aws-sdk');
        const cognito = new AWS.CognitoIdentityServiceProvider();
        
        // Calculate SECRET_HASH for client with secret
        const secretHash = calculateSecretHash(email, process.env.COGNITO_CLIENT_ID, process.env.COGNITO_CLIENT_SECRET);
        
        try {
            const authResult = await cognito.adminInitiateAuth({
                UserPoolId: process.env.COGNITO_USER_POOL_ID,
                ClientId: process.env.COGNITO_CLIENT_ID,
                AuthFlow: 'ADMIN_NO_SRP_AUTH',
                AuthParameters: {
                    USERNAME: email,
                    PASSWORD: password,
                    SECRET_HASH: secretHash
                }
            }).promise();
            
            console.log('Cognito auth result:', authResult);
            
            if (authResult.AuthenticationResult) {
                // Successful authentication
                req.session.user = {
                    id: authResult.AuthenticationResult.AccessToken,
                    email: email,
                    name: email.split('@')[0],
                    authMethod: 'cognito_traditional'
                };
                
                // Log successful login
                const clientInfo = getClientInfo(req);
                await loggingConfig.logAccess({
                    userId: req.session.user.id,
                    email: req.session.user.email,
                    eventType: 'login',
                    ipAddress: clientInfo.ipAddress,
                    userAgent: clientInfo.userAgent,
                    sessionId: req.sessionID,
                    metadata: {
                        authMethod: 'cognito_traditional',
                        domain: domain,
                        isProduction: isProduction
                    }
                });
                
                res.json({ success: true, user: req.session.user });
            } else {
                console.log('No authentication result from Cognito');
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } catch (authError) {
            console.error('Cognito authentication error:', authError);
            console.error('Error details:', {
                code: authError.code,
                message: authError.message,
                statusCode: authError.statusCode
            });
            
            // Provide more specific error messages based on the error type
            let errorMessage = 'Invalid credentials';
            if (authError.code === 'NotAuthorizedException') {
                if (authError.message.includes('SECRET_HASH')) {
                    errorMessage = 'Authentication configuration error';
                } else if (authError.message.includes('Incorrect username or password')) {
                    errorMessage = 'Invalid email or password';
                } else {
                    errorMessage = 'Authentication failed';
                }
            } else if (authError.code === 'UserNotFoundException') {
                errorMessage = 'User not found';
            } else if (authError.code === 'InvalidParameterException') {
                errorMessage = 'Invalid request parameters';
            }
            
            res.status(401).json({ error: errorMessage });
        }
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Add /logout route that redirects to /auth/logout
app.get('/logout', (req, res) => {
    res.redirect('/auth/logout');
});

app.get('/auth/logout', async (req, res) => {
    // Log logout event before destroying session
    if (req.session.user) {
        const clientInfo = getClientInfo(req);
        await loggingConfig.logAccess({
            userId: req.session.user.id,
            email: req.session.user.email,
            eventType: 'logout',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID,
            metadata: {}
        });
    }
    
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        // Redirect to login page instead of returning JSON
        res.redirect('/login');
    });
});

// ============ API Routes ============
// API route to get current user info
app.get('/api/user', (req, res) => {
    console.log('GET /api/user - Session ID:', req.sessionID);
    console.log('GET /api/user - Has session.user:', !!req.session.user);
    console.log('GET /api/user - Session:', JSON.stringify(req.session));
    console.log('GET /api/user - Cookies:', req.headers.cookie);
    
    if (req.session.user) {
        return res.json(req.session.user);
    }
    
    res.status(401).json({ error: 'Authentication required' });
});

// ChatKit session endpoint - generates client tokens for ChatKit
app.post('/api/chatkit/session', requireAuth, async (req, res) => {
    try {
        console.log('ChatKit session request received');
        
        // 👇 sanity logs (remove after it works)
        console.log("ENV sanity", {
            hasApiKey: Boolean(process.env.OPENAI_API_KEY),
            workflowId: process.env.OPENAI_CHATKIT_WORKFLOW_ID,
            publicKey: process.env.OPENAI_CHATKIT_PUBLIC_KEY ? 'SET' : 'NOT SET'
        });
        
        if (!process.env.OPENAI_API_KEY) {
            console.log('ERROR: OpenAI API Key not configured');
            return res.status(500).json({ 
                error: 'OpenAI API Key not configured' 
            });
        }
        
        if (!process.env.OPENAI_CHATKIT_WORKFLOW_ID) {
            console.log('ERROR: ChatKit Workflow ID not configured');
            return res.status(500).json({ 
                error: 'ChatKit Workflow ID not configured' 
            });
        }

        if (!process.env.OPENAI_CHATKIT_PUBLIC_KEY) {
            console.log('ERROR: OpenAI ChatKit Public Key not configured');
            return res.status(500).json({ 
                error: 'OpenAI ChatKit Public Key not configured' 
            });
        }

        // Use OpenAI API to create a proper session
        const client = getOpenAIClient();
        
        if (!client) {
            console.log('ERROR: OpenAI client not initialized');
            return res.status(500).json({ 
                error: 'OpenAI API Key not configured' 
            });
        }
        
        console.log('Creating ChatKit session...');
        
        // Get or create a stable user ID for this session
        let userId = req.session.user?.id || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const session = await client.beta.chatkit.sessions.create({
            user: userId,  // <-- REQUIRED parameter (string)
            workflow: {   // <-- must be an object, not a string
                id: process.env.OPENAI_CHATKIT_WORKFLOW_ID  // <-- must be string
                // optional: state_variables: { user_id: userId }
            }
            // NOTE: do NOT include `model` here - it's defined by the workflow
        });
        
        console.log('Session created successfully:', {
            hasClientToken: Boolean(session.clientToken),
            hasClientSecret: Boolean(session.client_secret),
            clientTokenType: typeof session.clientToken,
            clientSecretType: typeof session.client_secret,
            sessionKeys: Object.keys(session)
        });
        
        // ChatKit API returns client_secret, not clientToken
        const clientToken = session.clientToken || session.client_secret;
        
        if (!clientToken) {
            console.error('ERROR: Neither clientToken nor client_secret found!');
            return res.status(500).json({ 
                error: 'Session created but no client token found',
                sessionKeys: Object.keys(session)
            });
        }
        
        // Return the session information that ChatKit needs
        const sessionData = {
            clientToken: clientToken,
            publicKey: process.env.OPENAI_CHATKIT_PUBLIC_KEY
        };
        
        console.log('Sending ChatKit session data:', {
            clientToken: clientToken.substring(0, 20) + '...',
            publicKey: sessionData.publicKey.substring(0, 20) + '...'
        });
        
        res.json(sessionData);

    } catch (error) {
        console.error('ChatKit session error:', error);
        console.error("session.create failed:", error?.response?.data ?? error?.message ?? error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

// Simple ChatKit endpoint - just returns success for the web component
app.post('/api/chatkit/message', requireAuth, async (req, res) => {
    try {
        // The ChatKit web component handles the actual chat logic
        // This endpoint just needs to return success for authentication
        res.json({
            success: true,
            message: 'ChatKit web component will handle the chat'
        });

    } catch (error) {
        console.error('ChatKit endpoint error:', error);
        res.status(500).json({ 
            error: 'Failed to process request',
            details: error.message 
        });
    }
});

// ============ Access Log API Endpoints ============
// Get access logs for a specific user (admin only)
app.get('/api/admin/access-logs/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;
        
        const logs = await loggingConfig.queryUserLogs(userId, startDate, endDate);
        res.json({
            success: true,
            userId,
            logs,
            count: logs.length
        });
    } catch (error) {
        console.error('Failed to get access logs:', error);
        res.status(500).json({ error: 'Failed to retrieve access logs' });
    }
});

// Get all access logs (admin only)
app.get('/api/admin/access-logs', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate, userEmail, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        // Use the logging configuration wrapper to get logs
        let logs = await loggingConfig.getAllAccessLogs(startDate, endDate);
        
        // Filter by user email if provided
        if (userEmail) {
            logs = logs.filter(log => 
                log.email && log.email.toLowerCase().includes(userEmail.toLowerCase())
            );
        }
        
        // Calculate pagination
        const totalCount = logs.length;
        const totalPages = Math.ceil(totalCount / limitNum);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        const paginatedLogs = logs.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            logs: paginatedLogs,
            count: paginatedLogs.length,
            totalCount,
            totalPages,
            currentPage: pageNum,
            limit: limitNum
        });
    } catch (error) {
        console.error('Failed to get all access logs:', error);
        res.status(500).json({ error: 'Failed to retrieve access logs' });
    }
});

// Get access statistics (admin only)
app.get('/api/admin/access-stats', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const stats = await loggingConfig.getAccessStats(startDate, endDate);
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Failed to get access stats:', error);
        res.status(500).json({ error: 'Failed to retrieve access statistics' });
    }
});

// Get all users (admin only)
app.get('/api/admin/users', requireAuth, async (req, res) => {
    try {
        const { userType, userName, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        
        const users = await loggingConfig.getAllUsers(userType, userName);
        
        // Calculate pagination
        const totalCount = users.length;
        const totalPages = Math.ceil(totalCount / limitNum);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        const paginatedUsers = users.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            users: paginatedUsers,
            count: paginatedUsers.length,
            totalCount,
            totalPages,
            currentPage: pageNum,
            limit: limitNum,
            stats: {
                totalUsers: totalCount,
                activeUsers: users.filter(user => user.lastAccess).length,
                newUsers: users.filter(user => user.userType === 'New').length
            }
        });
    } catch (error) {
        console.error('Failed to get users:', error);
        res.status(500).json({ error: 'Failed to retrieve users' });
    }
});

// Search user names for autocomplete (admin only)
app.get('/api/admin/users/search-names', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.json({ success: true, names: [] });
        }
        
        const names = await loggingConfig.searchUserNames(q);
        
        res.json({
            success: true,
            names: names
        });
    } catch (error) {
        console.error('Failed to search user names:', error);
        res.status(500).json({ error: 'Failed to search user names' });
    }
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Chat interface is running',
        timestamp: new Date().toISOString()
    });
});

// Logger status endpoint (for debugging)
app.get('/api/logger-status', (req, res) => {
    res.json({
        loggerType: loggingConfig.loggerType,
        loggerInstance: loggingConfig.logger.constructor.name,
        hasPostgreSQLVars: !!(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) || !!(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Debug endpoint to check environment variables
app.get('/api/debug-env', (req, res) => {
    res.json({
        PGHOST: process.env.PGHOST ? 'SET' : 'NOT SET',
        PGDATABASE: process.env.PGDATABASE ? 'SET' : 'NOT SET', 
        PGUSER: process.env.PGUSER ? 'SET' : 'NOT SET',
        PGPASSWORD: process.env.PGPASSWORD ? 'SET' : 'NOT SET',
        DB_HOST: process.env.DB_HOST ? 'SET' : 'NOT SET',
        DB_NAME: process.env.DB_NAME ? 'SET' : 'NOT SET',
        DB_USER: process.env.DB_USER ? 'SET' : 'NOT SET',
        DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT SET',
        allEnvKeys: Object.keys(process.env).filter(key => key.includes('DB') || key.includes('PG')).sort(),
        loggerType: loggingConfig.loggerType,
        loggerInstance: loggingConfig.logger.constructor.name
    });
});

// Test endpoint to trigger access logging
app.get('/api/test-logging', async (req, res) => {
    try {
        const clientInfo = getClientInfo(req);
        console.log('Test logging - attempting to log access:', {
            userId: 'test-user-123',
            email: 'test@example.com',
            eventType: 'test',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID
        });
        
        await loggingConfig.logAccess({
            userId: 'test-user-123',
            email: 'test@example.com',
            eventType: 'test',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID,
            metadata: { test: true, timestamp: new Date().toISOString() }
        });
        
        console.log('Test logging - access log entry created successfully');
        res.json({ success: true, message: 'Test access log entry created' });
    } catch (error) {
        console.error('Test logging error:', error);
        res.status(500).json({ error: 'Failed to create test log entry', details: error.message });
    }
});

// Debug endpoint to check recent access logs
app.get('/api/recent-logs', async (req, res) => {
    try {
        const logs = await loggingConfig.getAllUsers();
        res.json({ 
            success: true, 
            count: logs.length,
            logs: logs.slice(0, 10) // Show last 10 entries
        });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs', details: error.message });
    }
});

// Debug endpoint to check all access log entries
app.get('/api/all-logs', async (req, res) => {
    try {
        // Query all access logs directly from the database
        const sql = `
            SELECT * FROM access_logs 
            ORDER BY timestamp DESC 
            LIMIT 50
        `;
        const result = await loggingConfig.logger.pool.query(sql);
        res.json({ 
            success: true, 
            count: result.rows.length,
            logs: result.rows
        });
    } catch (error) {
        console.error('Error fetching all logs:', error);
        res.status(500).json({ error: 'Failed to fetch all logs', details: error.message });
    }
});

// Debug endpoint to test admin users data (no auth required)
app.get('/api/debug-admin-users', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const users = await loggingConfig.getAllUsers(startDate, endDate);
        res.json({
            success: true,
            users,
            stats: {
                totalUsers: users.length,
                activeUsers: users.filter(user => user.lastAccess).length,
                newUsers: users.filter(user => {
                    const firstAccess = new Date(user.firstAccess);
                    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    return firstAccess > thirtyDaysAgo;
                }).length
            },
            queryParams: { startDate, endDate },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching admin users:', error);
        res.status(500).json({ error: 'Failed to fetch admin users', details: error.message });
    }
});

// ============ Static File Serving ============
// Serve static files from dist directory (bundle.js, etc.)
app.use(express.static('dist'));

// Serve constants.js file
app.get('/constants.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'constants.js'));
});

// ============ HTML Page Routes ============
// Login page route
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Admin menu route
app.get('/admin', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-menu.html'));
});

// Admin access log route
app.get('/admin/access-log', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Admin users route
app.get('/admin/users', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-users.html'));
});

// Test route - serve static HTML
app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

// Direct React test - serve HTML that directly includes bundle.js
app.get('/direct', (req, res) => {
    res.sendFile(path.join(__dirname, 'direct-test.html'));
});

// Fixed React test - serve the exact same HTML as direct but through main route
app.get('/fixed', (req, res) => {
    res.sendFile(path.join(__dirname, 'fixed-index.html'));
});

// Vanilla React test - uses React from CDN, not webpack bundle
app.get('/vanilla', (req, res) => {
    res.sendFile(path.join(__dirname, 'vanilla-test.html'));
});

// Simple webpack test - uses simpler webpack config without minimization
app.get('/simple', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist-simple', 'index.html'));
});

// ============ Root Route (Must be LAST) ============
// Serve React app to everyone - let React handle authentication
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Chat interface server running on port ${PORT}`);
    console.log(`📱 Access your chat at: http://localhost:${PORT}`);
    console.log(`🔐 AWS Cognito authentication enabled for kyocare.com domain`);
});