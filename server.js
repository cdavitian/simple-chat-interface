const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const AWS = require('aws-sdk');
const OpenAI = require('openai');
const { runAgentConversation } = require('./sdk-agent');
const { getFileConfig, prepareMessageParts } = require('./services/fileHandler.service');
const crypto = require('crypto');
const LoggingConfig = require('./logging-config');
const pgSession = require('connect-pg-simple');
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

// S3 upload configuration constants
const S3_UPLOAD_PREFIX = process.env.S3_CHATKIT_UPLOAD_PREFIX || 'chatkit-uploads';
const S3_MAX_FILE_BYTES = Number(process.env.S3_CHATKIT_MAX_FILE_BYTES || 20 * 1024 * 1024);
const S3_UPLOAD_URL_TTL = Number(process.env.S3_CHATKIT_UPLOAD_URL_TTL || 15 * 60);
const S3_DOWNLOAD_URL_TTL = Number(process.env.S3_CHATKIT_DOWNLOAD_URL_TTL || 60 * 60);

// Helper function to convert S3 stream to buffer
const streamToBuffer = async (stream) => {
    if (!stream) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(stream)) {
        return stream;
    }

    if (typeof stream.transformToByteArray === 'function') {
        const array = await stream.transformToByteArray();
        return Buffer.from(array);
    }

    if (typeof stream.arrayBuffer === 'function') {
        const arrayBuffer = await stream.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    if (typeof stream.pipe === 'function') {
        return await new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.once('error', (err) => reject(err));
            stream.once('end', () => resolve(Buffer.concat(chunks)));
        });
    }

    // Fallback: assume it's already a buffer or can be converted
    return Buffer.from(stream);
};

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

// Configure session store - use PostgreSQL if available, otherwise MemoryStore for local dev
let sessionStore;
const SessionStore = pgSession(session);

// Check if PostgreSQL is available (same logic as LoggingConfig)
const hasPostgreSQLVars = (
    (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD) ||
    (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD)
);

if (hasPostgreSQLVars && loggingConfig.loggerType === 'postgresql' && loggingConfig.logger && loggingConfig.logger.pool) {
    // Use PostgreSQL session store
    sessionStore = new SessionStore({
        pool: loggingConfig.logger.pool,
        tableName: 'user_sessions', // Custom table name
        createTableIfMissing: true
    });
    console.log('✅ Using PostgreSQL session store (production-ready)');
} else {
    // Fallback to MemoryStore only for local development
    console.log('⚠️  Using MemoryStore (local development only - not suitable for production)');
}

app.use(session({
    store: sessionStore,
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

// Middleware to log session lifecycle (initiation and termination)
app.use(async (req, res, next) => {
    // Log session initiation when user data is set (but not yet logged)
    if (req.session.user && !req.session._sessionLogged) {
        await logSessionInitiation(req);
        req.session._sessionLogged = true; // Mark as logged to prevent duplicate logging
    }

    next();
});

// Helper function to log session initiation
async function logSessionInitiation(req) {
    try {
        if (loggingConfig.loggerType === 'postgresql' && loggingConfig.logger && loggingConfig.logger.logSessionInitiation) {
            const clientInfo = getClientInfo(req);
            const expirationTime = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours from now
            
            await loggingConfig.logger.logSessionInitiation({
                session_id: req.sessionID,
                user_id: req.session.user?.id || null,
                user_email: req.session.user?.email || null,
                expiration_timestamp: expirationTime,
                ip_address: clientInfo.ipAddress,
                user_agent: clientInfo.userAgent,
                metadata: {
                    authMethod: req.session.user?.authMethod || 'oauth',
                    name: req.session.user?.name || null
                }
            });
        }
    } catch (error) {
        console.error('Error in logSessionInitiation middleware:', error);
        // Don't break the request flow
    }
}

// Helper function to log session termination
async function logSessionTermination(req, reason = 'expired') {
    try {
        if (loggingConfig.loggerType === 'postgresql' && loggingConfig.logger && loggingConfig.logger.logSessionTermination) {
            await loggingConfig.logger.logSessionTermination({
                session_id: req.sessionID || req.session?.id,
                termination_reason: reason,
                metadata: {
                    user_id: req.session?.user?.id || null,
                    user_email: req.session?.user?.email || null
                }
            });
        }
    } catch (error) {
        console.error('Error in logSessionTermination middleware:', error);
        // Don't break the request flow
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add X-Robots-Tag header to all responses to prevent search engine indexing
app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});

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

// Helper function to get user type from database
const getUserType = async (email) => {
    try {
        const sql = `
            SELECT user_type 
            FROM users 
            WHERE email = $1
        `;
        const result = await loggingConfig.logger.pool.query(sql, [email]);
        return result.rows[0]?.user_type || 'New';
    } catch (error) {
        console.error('Error getting user type:', error);
        return 'New'; // Default to 'New' if error
    }
};

// Middleware to check user type and redirect accordingly
const checkUserPermissions = async (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    try {
        const userType = await getUserType(req.session.user.email);
        req.session.user.userType = userType;
        
        // Store user type in session for easy access
        req.session.userType = userType;
        
        next();
    } catch (error) {
        console.error('Error checking user permissions:', error);
        req.session.user.userType = 'New';
        req.session.userType = 'New';
        next();
    }
};

// Middleware to require admin access
const requireAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userType = req.session.user.userType || req.session.userType;
    if (userType !== 'Admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
};

// Serve static files from public directory (avatars, etc)
app.use('/public', express.static('public'));

// Serve styles.css from root for login page
app.use('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'styles.css'));
});

// ============ Authentication Routes ============

// Helper function to get the origin URL from request
const getOriginUrl = (req) => {
    // In production (Railway), trust proxy is enabled, so req.protocol should be correct
    // Check X-Forwarded-Proto header first, then req.protocol, then default to https
    const protocol = req.get('x-forwarded-proto') || req.protocol || (isProduction ? 'https' : 'http');
    const host = req.get('host') || req.headers.host || req.get('x-forwarded-host');
    
    if (!host) {
        console.error('Could not determine host from request');
        // Fallback to environment variable or default
        return process.env.RAILWAY_PUBLIC_DOMAIN 
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : 'https://simple-chat-interface-production.up.railway.app';
    }
    
    return `${protocol}://${host}`;
};

// Helper function to get the appropriate redirect URI based on origin
const getRedirectUri = (origin) => {
    // Check if we have environment-specific redirect URIs
    const stagingRedirectUri = process.env.COGNITO_REDIRECT_URI_STAGING;
    const productionRedirectUri = process.env.COGNITO_REDIRECT_URI_PRODUCTION || process.env.COGNITO_REDIRECT_URI;
    
    // Detect if this is staging based on origin
    if (origin && origin.includes('staging')) {
        return stagingRedirectUri || `${origin}/auth/cognito/callback`;
    }
    
    // Default to production or fallback to origin-based
    return productionRedirectUri || `${origin}/auth/cognito/callback`;
};

// AWS Cognito Hosted UI Routes for Google OAuth
app.get('/auth/cognito', (req, res) => {
    const cognitoDomain = process.env.COGNITO_HOSTED_UI_DOMAIN;
    const clientId = process.env.COGNITO_CLIENT_ID;
    
    if (!cognitoDomain || !clientId) {
        console.error('Missing Cognito configuration for Google OAuth');
        return res.status(500).json({ error: 'OAuth configuration missing' });
    }
    
    // Get the origin URL from the request
    const origin = getOriginUrl(req);
    
    // Store the origin in session so we can redirect back to the same environment
    req.session.origin = origin;
    
    // Get the appropriate redirect URI based on origin
    const redirectUri = getRedirectUri(origin);
    
    if (!redirectUri) {
        console.error('No redirect URI configured');
        return res.status(500).json({ error: 'OAuth redirect URI not configured' });
    }
    
    const authUrl = `https://${cognitoDomain}/oauth2/authorize?` +
        `client_id=${clientId}&` +
        `response_type=code&` +
        `scope=email+openid+profile&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    console.log('Redirecting to Cognito OAuth:', {
        origin,
        redirectUri,
        authUrl: authUrl.substring(0, 100) + '...'
    });
    res.redirect(authUrl);
});

app.get('/auth/cognito/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            console.error('No authorization code received');
            // Get origin from session or request
            const origin = req.session?.origin || getOriginUrl(req);
            return res.redirect(`${origin}/login?error=no_code`);
        }
        
        console.log('Received authorization code:', code.substring(0, 10) + '...');
        
        // Get the origin from session or current request
        const origin = req.session?.origin || getOriginUrl(req);
        const redirectUri = getRedirectUri(origin);
        
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
                redirect_uri: redirectUri,
            }),
        });
        
        const tokens = await tokenResponse.json();
        
        if (tokens.error) {
            console.error('Token exchange failed:', tokens);
            return res.redirect(`${origin}/login?error=token_exchange_failed`);
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
            return res.redirect(`${origin}/login?error=user_info_failed`);
        }
        
        console.log('User info received:', { email: userInfo.email, name: userInfo.name });
        
        // Check domain restriction
        const email = userInfo.email;
        const domain = email.split('@')[1];
        
        if (domain !== 'kyocare.com') {
            console.log('Domain restriction failed for:', domain);
            return res.redirect(`${origin}/login?error=access_denied`);
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
        
        // Log session initiation for permanent session log
        await logSessionInitiation(req);
        
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
        
        // Redirect to homepage on the same origin (staging or production)
        // Clear the origin from session after use
        const redirectOrigin = req.session?.origin || origin;
        delete req.session.origin;
        res.redirect(`${redirectOrigin}/homepage`);
        
    } catch (error) {
        console.error('Cognito OAuth callback error:', error);
        const errorOrigin = req.session?.origin || getOriginUrl(req);
        delete req.session.origin;
        res.redirect(`${errorOrigin}/login?error=oauth_failed`);
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
                
                // Log session initiation for permanent session log
                await logSessionInitiation(req);
                
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
    const origin = getOriginUrl(req);
    res.redirect(`${origin}/auth/logout`);
});

app.get('/auth/logout', async (req, res) => {
    // Log session termination for permanent session log
    await logSessionTermination(req, 'logout');
    
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
    
    const origin = getOriginUrl(req);
    
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        // Redirect to login page on the same origin
        res.redirect(`${origin}/login`);
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

// Helper functions for vector store operations via HTTP API
// Used when the SDK doesn't expose beta.vectorStores (e.g., SDK v6.5.0)
// Following OpenAI API: POST https://api.openai.com/v1/vector_stores

async function createVectorStoreViaHTTP(name, apiKey) {
    const https = require('https');
    
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ name });
        
        const options = {
            hostname: 'api.openai.com',
            path: '/v1/vector_stores',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'OpenAI-Beta': 'assistants=v2'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        // Only log on errors or first creation - reduce verbosity
                        resolve(parsed);
                    } catch (e) {
                        console.error('❌ Failed to parse HTTP response:', {
                            error: e.message,
                            body: data,
                            statusCode: res.statusCode
                        });
                        reject(new Error(`Failed to parse response: ${e.message}, body: ${data}`));
                    }
                } else {
                    console.error('❌ HTTP API error response:', {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data,
                        operation: 'create vector store'
                    });
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ HTTP request error:', {
                error: error.message,
                stack: error.stack,
                operation: 'create vector store'
            });
            reject(error);
        });
        req.write(postData);
        req.end();
    });
}

async function retrieveVectorStoreViaHTTP(vectorStoreId, apiKey) {
    const https = require('https');
    
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.openai.com',
            path: `/v1/vector_stores/${vectorStoreId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'OpenAI-Beta': 'assistants=v2'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        // Silent on success - only log errors
                        resolve(parsed);
                    } catch (e) {
                        console.error('❌ Failed to parse HTTP response:', {
                            error: e.message,
                            body: data,
                            statusCode: res.statusCode
                        });
                        reject(new Error(`Failed to parse response: ${e.message}, body: ${data}`));
                    }
                } else {
                    console.error('❌ HTTP API error response:', {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data,
                        operation: 'retrieve vector store'
                    });
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ HTTP request error:', {
                error: error.message,
                stack: error.stack,
                operation: 'retrieve vector store'
            });
            reject(error);
        });
        req.end();
    });
}

async function addFileToVectorStoreViaHTTP(vectorStoreId, fileId, apiKey) {
    const https = require('https');
    
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ file_id: fileId });
        
        const options = {
            hostname: 'api.openai.com',
            path: `/v1/vector_stores/${vectorStoreId}/files`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'OpenAI-Beta': 'assistants=v2'
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        // Silent on success - only log errors
                        resolve(parsed);
                    } catch (e) {
                        console.error('❌ Failed to parse HTTP response:', {
                            error: e.message,
                            body: data,
                            statusCode: res.statusCode
                        });
                        reject(new Error(`Failed to parse response: ${e.message}, body: ${data}`));
                    }
                } else {
                    console.error('❌ HTTP API error response:', {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data,
                        operation: 'add file to vector store'
                    });
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ HTTP request error:', {
                error: error.message,
                stack: error.stack,
                operation: 'add file to vector store'
            });
            reject(error);
        });
        req.write(postData);
        req.end();
    });
}

// Helper function to get or create vector store for a session
// Uses core OpenAI client's beta.vectorStores API, with HTTP fallback if SDK doesn't support it
// Following pattern: Use core OpenAI client for vector stores, Agents SDK for orchestration
async function getOrCreateVectorStore(client, sessionObj, sessionId, userId) {
    try {
        // Validate client
        if (!client) {
            throw new Error('OpenAI client is null or undefined');
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY not found in environment');
        }

        // Check if we already have a vector store for this session
        if (sessionObj?.vectorStoreId) {
            try {
                // Try SDK method first (if available in this SDK version)
                let existing;
                if (client.beta?.vectorStores?.retrieve) {
                    existing = await client.beta.vectorStores.retrieve(sessionObj.vectorStoreId);
                } else {
                    // Fallback to HTTP API when SDK doesn't expose beta.vectorStores
                    existing = await retrieveVectorStoreViaHTTP(sessionObj.vectorStoreId, apiKey);
                }
                // Log only if there are files or if this is a new session
                if (existing.file_counts?.total > 0) {
                    console.log('✅ Using existing vector store:', {
                        vectorStoreId: sessionObj.vectorStoreId,
                        fileCount: existing.file_counts?.total
                    });
                }
                return sessionObj.vectorStoreId;
            } catch (e) {
                console.warn('⚠️ Existing vector store not found, creating new one:', {
                    vectorStoreId: sessionObj.vectorStoreId,
                    error: e?.message
                });
                // If it doesn't exist, create a new one
            }
        }

        // Create a new vector store for this session
        // Pattern: Use core OpenAI client for vector stores (not Agents SDK)
        const vectorStoreName = `session:${sessionId || `user_${userId}_${Date.now()}`}`;
        console.log('🔨 Creating new vector store:', { name: vectorStoreName });
        
        let vectorStore;
        if (client.beta?.vectorStores?.create) {
            // Use SDK if available (core OpenAI client should have this)
            vectorStore = await client.beta.vectorStores.create({
                name: vectorStoreName,
            });
        } else {
            // Fallback to HTTP API when SDK doesn't expose beta.vectorStores
            console.log('📡 Using HTTP API fallback for vector store creation (SDK v6.5.0 limitation)');
            vectorStore = await createVectorStoreViaHTTP(vectorStoreName, apiKey);
        }

        console.log('✅ Created new vector store:', {
            vectorStoreId: vectorStore.id,
            name: vectorStore.name
        });

        // Store vector store ID in session
        try {
            sessionObj.vectorStoreId = vectorStore.id;
        } catch (e) {
            console.error('❌ Unable to persist vectorStoreId in session:', e?.message);
            // Still return the ID even if we can't persist it
        }

        return vectorStore.id;
    } catch (error) {
        console.error('❌ Failed to get or create vector store:', {
            error: error?.message,
            stack: error?.stack,
            sessionId,
            userId,
            httpError: error?.message?.includes('HTTP') ? error.message : undefined
        });
        throw error;
    }
}

// ChatKit session endpoint - generates client tokens for ChatKit
// Supports both GET and POST for flexibility
app.get('/api/chatkit/session', requireAuth, async (req, res) => {
    try {
        console.log('ChatKit session request received (GET)');
        
        // Set cache headers to prevent any caching (critical for fresh tokens)
        res.set('Cache-Control', 'no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
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
                id: process.env.OPENAI_CHATKIT_WORKFLOW_ID,  // <-- must be string
                // optional: state_variables: { user_id: userId }
            },
            chatkit_configuration: {
                file_upload: {
                    enabled: false,  // your tool owns uploads
                    accept: [
                        "text/csv",
                        "application/csv",
                        "application/vnd.ms-excel",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/octet-stream",  // fallback for some CSV/XLS files
                        "application/pdf",
                        "image/*"
                    ],
                    max_file_size_megabytes: 50
                }
            }
            // NOTE: do NOT include `model` here - it's defined by the workflow
        });
        
        console.log('Session created successfully:', {
            hasClientToken: Boolean(session.clientToken),
            hasClientSecret: Boolean(session.client_secret),
            hasSessionId: Boolean(session.id),
            clientTokenType: typeof session.clientToken,
            clientSecretType: typeof session.client_secret,
            sessionKeys: Object.keys(session)
        });
        
        // ChatKit API returns client_secret, not clientToken
        const clientToken = session.clientToken || session.client_secret;
        const sessionId = session.id;
        
        // Create or get vector store for this session
        let vectorStoreId = null;
        try {
            console.log('🔍 ChatKit (GET): Attempting to get or create vector store...', {
                sessionId,
                userId,
                hasExistingVectorStore: !!req.session?.vectorStoreId
            });
            vectorStoreId = await getOrCreateVectorStore(client, req.session, sessionId, userId);
            console.log('✅ Vector store ready for ChatKit session (GET):', {
                sessionId,
                vectorStoreId,
                storedInSession: !!req.session.vectorStoreId,
                sessionVectorStoreId: req.session.vectorStoreId
            });
        } catch (vectorStoreError) {
            console.error('❌ Failed to create vector store (GET):', {
                error: vectorStoreError?.message,
                stack: vectorStoreError?.stack,
                name: vectorStoreError?.name,
                sessionId,
                userId
            });
            // Continue even if vector store creation fails, but log it prominently
        }
        
        // Persist the latest ChatKit session id in the user's server session for reuse/fallbacks
        try {
            req.session.chatkitSessionId = sessionId;
        } catch (e) {
            console.warn('Unable to persist chatkitSessionId in session (GET):', e?.message);
        }
        
        if (!clientToken) {
            console.error('ERROR: Neither clientToken nor client_secret found!');
            return res.status(500).json({ 
                error: 'Session created but no client token found',
                sessionKeys: Object.keys(session)
            });
        }
        
        if (!sessionId) {
            console.error('ERROR: Session ID not found in session response!');
            return res.status(500).json({ 
                error: 'Session created but no session ID found',
                sessionKeys: Object.keys(session)
            });
        }
        
        // Log server time and token expiry (if decodable) to diagnose clock/expiry issues
        try {
            let expiresAtSeconds;
            if (typeof clientToken === 'string' && clientToken.startsWith('ek_')) {
                const parts = clientToken.split('_');
                const b64 = parts[parts.length - 1].replace(/[^A-Za-z0-9+/=]/g, '');
                const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
                expiresAtSeconds = payload.expires_at || payload.expiresAt;
            }
            const serverNowIso = new Date().toISOString();
            const expiresIso = typeof expiresAtSeconds === 'number' ? new Date(expiresAtSeconds * 1000).toISOString() : 'unknown';
            const msUntilExpiry = typeof expiresAtSeconds === 'number' ? (expiresAtSeconds * 1000 - Date.now()) : 'unknown';
            console.log('ChatKit token timing (GET):', { serverNow: serverNowIso, expiresAt: expiresIso, msUntilExpiry });
        } catch (e) {
            console.log('ChatKit token timing log failed (GET):', e.message);
        }

        // Choose public key based on request host (use a local key for localhost)
        const hostHeader = req.headers.host || '';
        const isLocalHost = /(^localhost)|(127\.0\.0\.1)/i.test(hostHeader);
        const publicKey = isLocalHost && process.env.OPENAI_CHATKIT_PUBLIC_KEY_LOCAL
            ? process.env.OPENAI_CHATKIT_PUBLIC_KEY_LOCAL
            : process.env.OPENAI_CHATKIT_PUBLIC_KEY;

        // Return the session information that ChatKit needs
        const sessionData = {
            clientToken: clientToken,
            publicKey: publicKey,
            sessionId: sessionId
        };
        
        console.log('Sending ChatKit session data:', {
            clientToken: clientToken.substring(0, 20) + '...',
            publicKey: sessionData.publicKey.substring(0, 20) + '...',
            sessionId: sessionId
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

// POST endpoint for backwards compatibility (also returns no-store)
app.post('/api/chatkit/session', requireAuth, async (req, res) => {
    try {
        console.log('ChatKit session request received (POST)');
        
        // Set cache headers to prevent any caching (critical for fresh tokens)
        res.set('Cache-Control', 'no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        
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
                id: process.env.OPENAI_CHATKIT_WORKFLOW_ID,  // <-- must be string
                // optional: state_variables: { user_id: userId }
            },
            chatkit_configuration: {
                file_upload: {
                    enabled: false,  // your tool owns uploads
                    accept: [
                        "text/csv",
                        "application/csv",
                        "application/vnd.ms-excel",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/octet-stream",  // fallback for some CSV/XLS files
                        "application/pdf",
                        "image/*"
                    ],
                    max_file_size_megabytes: 50
                }
            }
            // NOTE: do NOT include `model` here - it's defined by the workflow
        });
        
        console.log('Session created successfully:', {
            hasClientToken: Boolean(session.clientToken),
            hasClientSecret: Boolean(session.client_secret),
            hasSessionId: Boolean(session.id),
            clientTokenType: typeof session.clientToken,
            clientSecretType: typeof session.client_secret,
            sessionKeys: Object.keys(session)
        });
        
        // ChatKit API returns client_secret, not clientToken
        const clientToken = session.clientToken || session.client_secret;
        const sessionId = session.id;
        
        // Create or get vector store for this session
        let vectorStoreId = null;
        try {
            console.log('🔍 ChatKit (POST): Attempting to get or create vector store...', {
                sessionId,
                userId,
                hasExistingVectorStore: !!req.session?.vectorStoreId
            });
            vectorStoreId = await getOrCreateVectorStore(client, req.session, sessionId, userId);
            console.log('✅ Vector store ready for ChatKit session (POST):', {
                sessionId,
                vectorStoreId,
                storedInSession: !!req.session.vectorStoreId,
                sessionVectorStoreId: req.session.vectorStoreId
            });
        } catch (vectorStoreError) {
            console.error('❌ Failed to create vector store (POST):', {
                error: vectorStoreError?.message,
                stack: vectorStoreError?.stack,
                name: vectorStoreError?.name,
                sessionId,
                userId
            });
            // Continue even if vector store creation fails, but log it prominently
        }
        
        if (!clientToken) {
            console.error('ERROR: Neither clientToken nor client_secret found!');
            return res.status(500).json({ 
                error: 'Session created but no client token found',
                sessionKeys: Object.keys(session)
            });
        }
        
        if (!sessionId) {
            console.error('ERROR: Session ID not found in session response!');
            return res.status(500).json({ 
                error: 'Session created but no session ID found',
                sessionKeys: Object.keys(session)
            });
        }
        
        // Log server time and token expiry (if decodable) to diagnose clock/expiry issues
        try {
            let expiresAtSeconds;
            if (typeof clientToken === 'string' && clientToken.startsWith('ek_')) {
                const parts = clientToken.split('_');
                const b64 = parts[parts.length - 1].replace(/[^A-Za-z0-9+/=]/g, '');
                const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
                expiresAtSeconds = payload.expires_at || payload.expiresAt;
            }
            const serverNowIso = new Date().toISOString();
            const expiresIso = typeof expiresAtSeconds === 'number' ? new Date(expiresAtSeconds * 1000).toISOString() : 'unknown';
            const msUntilExpiry = typeof expiresAtSeconds === 'number' ? (expiresAtSeconds * 1000 - Date.now()) : 'unknown';
            console.log('ChatKit token timing (POST):', { serverNow: serverNowIso, expiresAt: expiresIso, msUntilExpiry });
        } catch (e) {
            console.log('ChatKit token timing log failed (POST):', e.message);
        }

        // Choose public key based on request host (use a local key for localhost)
        const hostHeader = req.headers.host || '';
        const isLocalHost = /(^localhost)|(127\.0\.0\.1)/i.test(hostHeader);
        const publicKey = isLocalHost && process.env.OPENAI_CHATKIT_PUBLIC_KEY_LOCAL
            ? process.env.OPENAI_CHATKIT_PUBLIC_KEY_LOCAL
            : process.env.OPENAI_CHATKIT_PUBLIC_KEY;

        // Return the session information that ChatKit needs
        const sessionData = {
            clientToken: clientToken,
            publicKey: publicKey,
            sessionId: sessionId
        };
        
        console.log('Sending ChatKit session data:', {
            clientToken: clientToken.substring(0, 20) + '...',
            publicKey: sessionData.publicKey.substring(0, 20) + '...',
            sessionId: sessionId
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

// ============ S3 Upload Endpoints ============
// Presign S3 upload for ChatKit attachments (following guidance pattern)
app.post('/api/uploads/presign', requireAuth, async (req, res) => {
    try {
        const bucketName = process.env.S3_BUCKET_NAME;
        const region = process.env.AWS_REGION || 'us-east-1';

        if (!bucketName) {
            console.error('S3 presign failed: S3_BUCKET_NAME not configured');
            return res.status(500).json({ error: 'S3 bucket is not configured (S3_BUCKET_NAME)' });
        }

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            console.error('S3 presign failed: AWS credentials missing');
            return res.status(500).json({ error: 'AWS credentials are not configured' });
        }

        const { filename, mime, size } = req.body || {};
        if (!filename) {
            return res.status(400).json({ error: 'filename is required' });
        }

        // Function to get correct MIME type from filename extension
        // Browsers often send incorrect or missing MIME types for CSV/XLS files
        const getContentTypeFromFilename = (filename, fallbackMime) => {
            const ext = filename.toLowerCase().split('.').pop();
            const mimeMap = {
                'csv': 'text/csv',
                'xls': 'application/vnd.ms-excel',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'pdf': 'application/pdf',
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp'
            };
            return mimeMap[ext] || (fallbackMime && typeof fallbackMime === 'string' && fallbackMime.trim() !== '' ? fallbackMime : 'application/octet-stream');
        };

        // Use filename extension to determine correct MIME type, fallback to provided mime if not found
        const safeContentType = getContentTypeFromFilename(filename, mime);

        if (Number.isFinite(S3_MAX_FILE_BYTES) && S3_MAX_FILE_BYTES > 0 && Number(size) > S3_MAX_FILE_BYTES) {
            const maxMb = Math.round((S3_MAX_FILE_BYTES / (1024 * 1024)) * 10) / 10;
            return res.status(413).json({ error: `File exceeds maximum size of ${maxMb} MB` });
        }

        // Sanitize filename and build an object key namespaced by user
        const safeName = String(filename).replace(/[^A-Za-z0-9._-]/g, '_');
        const userId = req.session.user?.id || 'anonymous';
        const timestamp = Date.now();
        const random = Math.random().toString(36).slice(2, 8);
        const normalizedPrefix = S3_UPLOAD_PREFIX.endsWith('/') ? S3_UPLOAD_PREFIX.slice(0, -1) : S3_UPLOAD_PREFIX;
        const objectKey = `${normalizedPrefix}/${userId}/${timestamp}-${random}-${safeName}`;

        const s3 = new AWS.S3({ region });
        const uploadUrl = await s3.getSignedUrlPromise('putObject', {
            Bucket: bucketName,
            Key: objectKey,
            Expires: Math.max(S3_UPLOAD_URL_TTL, 60), // ensure at least 60 seconds
            ContentType: safeContentType,
            ServerSideEncryption: 'AES256'  // SSE-S3 encryption
        });

        console.log('Generated S3 presign for ChatKit upload:', {
            userId,
            objectKey,
            contentType: safeContentType,
            size,
            bucketName,
            region
        });

        res.json({
            uploadUrl,
            objectKey,
            contentType: safeContentType  // Return so frontend uses exact same Content-Type in PUT
        });
    } catch (error) {
        console.error('Failed to presign S3 upload:', error);
        res.status(500).json({ error: 'Failed to presign upload', details: error.message });
    }
});

// Quiet ingest endpoint (S3 → Files → return file_id)
// No messages created, no responses created - just ingest and return file_id
app.post('/api/files/ingest-s3', requireAuth, async (req, res) => {
    try {
        const bucketName = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET;
        const region = process.env.AWS_REGION || 'us-east-1';
        const { key, bucket, filename } = req.body || {};

        const effectiveBucket = bucket || bucketName;
        if (!effectiveBucket) {
            return res.status(400).json({ error: 'S3 bucket is not configured' });
        }

        if (!key || typeof key !== 'string') {
            return res.status(400).json({ error: 'Missing S3 key' });
        }

        if (!process.env.OPENAI_API_KEY) {
            console.error('ingest-s3 failed: OpenAI API key missing');
            return res.status(500).json({ error: 'OpenAI API Key not configured' });
        }

        const s3 = new AWS.S3({ region });
        let objectData;

        try {
            objectData = await s3.getObject({ Bucket: effectiveBucket, Key: key }).promise();
        } catch (error) {
            console.error('Failed to read S3 object for ingest:', {
                key,
                bucket: effectiveBucket,
                message: error.message,
                code: error.code
            });
            return res.status(404).json({ error: 'Uploaded file not found in S3' });
        }

        const fileBuffer = await streamToBuffer(objectData.Body);

        if (!fileBuffer?.length) {
            console.error('ingest-s3 failed: Empty file buffer', { key });
            return res.status(500).json({ error: 'Failed to read uploaded file from S3' });
        }

        const client = getOpenAIClient();

        if (!client) {
            console.error('ingest-s3 failed: OpenAI client unavailable');
            return res.status(500).json({ error: 'OpenAI client unavailable' });
        }

        const resolvedFilename = filename || key.split('/').pop() || 'upload';
        const resolvedContentType = objectData.ContentType || 'application/octet-stream';

        // Convert buffer to File-like object for OpenAI
        let fileForUpload;
        if (typeof File !== 'undefined') {
            fileForUpload = new File([fileBuffer], resolvedFilename, { type: resolvedContentType });
        } else {
            fileForUpload = fileBuffer;
        }

        const uploaded = await client.files.create({
            file: fileForUpload,
            purpose: 'assistants',
        });

        console.log('Quiet ingest successful:', {
            file_id: uploaded.id,
            filename: resolvedFilename,
            content_type: resolvedContentType
        });

        // Add file to session's vector store for persistent file awareness
        // Create vector store if it doesn't exist (files are ingested before messages are sent)
        try {
            let vectorStoreId = req.session?.vectorStoreId;
            
            // If no vector store exists, create one now so files can be added
            if (!vectorStoreId) {
                console.log('🔍 ingest-s3: No vector store found, creating one...');
                try {
                    const userId = req.session.user?.id || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const sessionId = `ingest_${userId}_${req.sessionID}`;
                    vectorStoreId = await getOrCreateVectorStore(client, req.session, sessionId, userId);
                    console.log('✅ ingest-s3: Created vector store for file:', {
                        vectorStoreId,
                        file_id: uploaded.id
                    });
                } catch (createError) {
                    console.error('❌ ingest-s3: Failed to create vector store:', {
                        error: createError?.message,
                        stack: createError?.stack,
                        file_id: uploaded.id
                    });
                    // Continue - file still uploaded, just not in vector store
                }
            }
            
            console.log('🔍 ingest-s3: Checking for vector store:', {
                hasVectorStoreId: !!vectorStoreId,
                vectorStoreId: vectorStoreId || 'NONE',
                file_id: uploaded.id
            });
            
            if (vectorStoreId) {
                console.log('📤 ingest-s3: Adding file to vector store...', {
                    file_id: uploaded.id,
                    vectorStoreId
                });
                let vsFile;
                if (client.beta?.vectorStores?.files) {
                    vsFile = await client.beta.vectorStores.files.create(vectorStoreId, {
                        file_id: uploaded.id
                    });
                } else {
                    // Fallback to HTTP API
                    const apiKey = process.env.OPENAI_API_KEY;
                    vsFile = await addFileToVectorStoreViaHTTP(vectorStoreId, uploaded.id, apiKey);
                }
                console.log('✅ Added file to vector store (ingest-s3):', {
                    file_id: uploaded.id,
                    vectorStoreId,
                    status: vsFile.status
                });
            } else {
                console.warn('⚠️ No vector store available after creation attempt, file not added to vector store. File will only be available for immediate use.', {
                    file_id: uploaded.id,
                    sessionKeys: Object.keys(req.session || {})
                });
            }
        } catch (vectorStoreError) {
            console.error('❌ Failed to add file to vector store:', {
                error: vectorStoreError?.message,
                stack: vectorStoreError?.stack,
                file_id: uploaded.id,
                vectorStoreId: req.session?.vectorStoreId,
                errorType: vectorStoreError?.constructor?.name
            });
            // Continue even if vector store addition fails
        }

        let fileConfig;

        try {
            if (!req.session.chatkitFilesMetadata) {
                req.session.chatkitFilesMetadata = {};
            }

            fileConfig = getFileConfig({
                filename: resolvedFilename,
                content_type: resolvedContentType,
            });

            console.log('File category detection for ingest-s3:', {
                file_id: uploaded.id,
                filename: resolvedFilename,
                content_type: resolvedContentType,
                detected_category: fileConfig?.category,
                fileConfig: fileConfig
            });

            req.session.chatkitFilesMetadata[uploaded.id] = {
                content_type: resolvedContentType,
                filename: resolvedFilename,
                category: fileConfig?.category || null,
            };
        } catch (metadataError) {
            console.warn('Unable to persist chatkit file metadata in session:', metadataError?.message);
        }

        return res.json({ 
            file_id: uploaded.id, 
            filename: resolvedFilename,
            content_type: resolvedContentType,
            category: fileConfig?.category || null,
        });
    } catch (e) {
        console.error('ingest-s3 failed:', e);
        return res.status(500).json({ error: 'Failed to ingest S3 object', details: e.message });
    }
});

// Import from S3 to OpenAI Files API (following guidance pattern)
app.post('/api/openai/import-s3', requireAuth, async (req, res) => {
    try {
        const bucketName = process.env.S3_BUCKET_NAME;
        const region = process.env.AWS_REGION || 'us-east-1';
        const { objectKey, filename, purpose = 'assistants' } = req.body || {};

        if (!bucketName) {
            console.error('S3 import failed: S3_BUCKET_NAME not configured');
            return res.status(500).json({ error: 'S3 bucket is not configured (S3_BUCKET_NAME)' });
        }

        if (!objectKey || typeof objectKey !== 'string') {
            return res.status(400).json({ error: 'objectKey is required' });
        }

        if (!process.env.OPENAI_API_KEY) {
            console.error('S3 import failed: OpenAI API key missing');
            return res.status(500).json({ error: 'OpenAI API Key not configured' });
        }

        const s3 = new AWS.S3({ region });
        let objectData;

        try {
            objectData = await s3.getObject({ Bucket: bucketName, Key: objectKey }).promise();
        } catch (error) {
            console.error('Failed to read S3 object for import:', {
                objectKey,
                bucketName,
                message: error.message,
                code: error.code
            });
            return res.status(404).json({ error: 'Uploaded file not found in S3' });
        }

        const fileBuffer = await streamToBuffer(objectData.Body);

        if (!fileBuffer?.length) {
            console.error('S3 import failed: Empty file buffer', { objectKey });
            return res.status(500).json({ error: 'Failed to read uploaded file from S3' });
        }

        const client = getOpenAIClient();

        if (!client) {
            console.error('S3 import failed: OpenAI client unavailable');
            return res.status(500).json({ error: 'OpenAI client unavailable' });
        }

        const resolvedFilename = filename || path.basename(objectKey);
        const resolvedContentType = objectData.ContentType || 'application/octet-stream';

        console.log('Importing S3 file to OpenAI Files API:', {
            objectKey,
            resolvedFilename,
            resolvedContentType,
            purpose,
            size: fileBuffer.length
        });

        // Convert buffer to File-like object for OpenAI
        // Node.js 18+ has File API, but for compatibility we'll use a File-like object
        // OpenAI SDK accepts File, Blob, or Buffer
        let fileForUpload;
        if (typeof File !== 'undefined') {
            // Node.js 18+ has native File API
            fileForUpload = new File([fileBuffer], resolvedFilename, { type: resolvedContentType });
        } else {
            // Fallback: use Buffer directly (OpenAI SDK should accept it)
            fileForUpload = fileBuffer;
        }

        const uploadedFile = await client.files.create({
            file: fileForUpload,
            purpose: purpose
        });

        console.log('Successfully imported file to OpenAI:', {
            file_id: uploadedFile.id,
            filename: uploadedFile.filename,
            bytes: uploadedFile.bytes
        });

        // Add file to session's vector store for persistent file awareness
        try {
            const vectorStoreId = req.session?.vectorStoreId;
            if (vectorStoreId) {
                let vsFile;
                if (client.beta?.vectorStores?.files) {
                    vsFile = await client.beta.vectorStores.files.create(vectorStoreId, {
                        file_id: uploadedFile.id
                    });
                } else {
                    // Fallback to HTTP API
                    const apiKey = process.env.OPENAI_API_KEY;
                    vsFile = await addFileToVectorStoreViaHTTP(vectorStoreId, uploadedFile.id, apiKey);
                }
                console.log('✅ Added file to vector store:', {
                    file_id: uploadedFile.id,
                    vectorStoreId,
                    status: vsFile.status
                });
            } else {
                console.warn('⚠️ No vector store found in session, file not added to vector store. File will only be available for immediate use.', {
                    file_id: uploadedFile.id
                });
            }
        } catch (vectorStoreError) {
            console.error('❌ Failed to add file to vector store:', {
                error: vectorStoreError?.message,
                file_id: uploadedFile.id,
                vectorStoreId: req.session?.vectorStoreId
            });
            // Continue even if vector store addition fails
        }

        // Quiet ingest: stash file_id in the user's session for later injection (legacy support)
        try {
            if (!Array.isArray(req.session.chatkitFileIds)) {
                req.session.chatkitFileIds = [];
            }
            if (!req.session.chatkitFileIds.includes(uploadedFile.id)) {
                req.session.chatkitFileIds.push(uploadedFile.id);
            }
            console.log('Stashed file_id for quiet ingest:', {
                file_id: uploadedFile.id,
                totalStashed: req.session.chatkitFileIds.length
            });
        } catch (e) {
            console.warn('Unable to stash file_id in session:', e?.message);
        }

        res.json({
            file_id: uploadedFile.id,
            stashed_count: Array.isArray(req.session.chatkitFileIds) ? req.session.chatkitFileIds.length : 0
        });
    } catch (error) {
        console.error('Failed to import S3 file to OpenAI:', error);
        res.status(500).json({ error: 'Failed to import file from S3 to OpenAI', details: error.message });
    }
});

// Send message to ChatKit session with file attachment
app.post('/api/chatkit/message', requireAuth, async (req, res) => {
    try {
        const { session_id, file_id, text, staged_file_ids } = req.body || {};
        
        // Prefer explicit session_id from the client; fall back to the server-stored session id
        const effectiveSessionId = session_id || req.session?.chatkitSessionId;
        if (!effectiveSessionId) {
            return res.status(400).json({ error: 'session_id is required and no fallback session found on server' });
        }
        
        // Check for files in new format (with metadata) or legacy format
        const hasStagedFiles = Array.isArray(req.body.staged_files) && req.body.staged_files.length > 0;
        const hasStagedFileIds = Array.isArray(staged_file_ids) && staged_file_ids.length > 0;
        
        if (!text && !hasStagedFiles && !hasStagedFileIds && !file_id) {
            return res.status(400).json({ error: 'Either text or staged_files/staged_file_ids (or both) is required' });
        }
        
        if (!process.env.OPENAI_API_KEY) {
            console.error('ChatKit message failed: OpenAI API key missing');
            return res.status(500).json({ error: 'OpenAI API Key not configured' });
        }
        
        const client = getOpenAIClient();
        
        if (!client) {
            console.error('ChatKit message failed: OpenAI client unavailable');
            return res.status(500).json({ error: 'OpenAI client unavailable' });
        }
        
        // Build content array - only text, NO message-level file attachments
        // Files are accessed via vector store file_search, not message-level attachments
        const content = [];
        if (text) {
            content.push({ type: 'input_text', text: text });
        }

        // Collect file IDs that were uploaded (for logging only)
        // These files should already be in the vector store
        const uploadedFileIds = new Set();
        
        if (Array.isArray(req.body.staged_files)) {
            for (const fileInfo of req.body.staged_files) {
                if (fileInfo && typeof fileInfo.file_id === 'string' && fileInfo.file_id.trim()) {
                    uploadedFileIds.add(fileInfo.file_id.trim());
                }
            }
        }
        if (Array.isArray(staged_file_ids)) {
            for (const fid of staged_file_ids) {
                if (typeof fid === 'string' && fid.trim()) {
                    uploadedFileIds.add(fid.trim());
                }
            }
        }
        if (Array.isArray(req.session?.chatkitFileIds)) {
            for (const fid of req.session.chatkitFileIds) {
                if (typeof fid === 'string' && fid.trim()) {
                    uploadedFileIds.add(fid.trim());
                }
            }
        }
        if (file_id && typeof file_id === 'string') {
            uploadedFileIds.add(file_id.trim());
        }
        
        // Verify vector store exists and log file availability
        const vectorStoreId = req.session?.vectorStoreId;
        if (vectorStoreId && uploadedFileIds.size > 0) {
            try {
                let vs;
                if (client.beta?.vectorStores) {
                    vs = await client.beta.vectorStores.retrieve(vectorStoreId);
                } else {
                    // Fallback to HTTP API
                    const apiKey = process.env.OPENAI_API_KEY;
                    vs = await retrieveVectorStoreViaHTTP(vectorStoreId, apiKey);
                }
                // Only log if there's a mismatch or if files are being uploaded
                if (uploadedFileIds.size > 0 || vs.file_counts?.total > 0) {
                    console.log('📁 Vector store file access:', {
                        vectorStoreId,
                        uploadedFiles: uploadedFileIds.size,
                        totalFiles: vs.file_counts?.total || 0
                    });
                }
            } catch (e) {
                console.warn('⚠️ Could not verify vector store, but continuing:', e?.message);
            }
        } else if (uploadedFileIds.size > 0) {
            console.warn('⚠️ Files uploaded but no vector store available. Files may not be accessible:', {
                uploadedFileIds: Array.from(uploadedFileIds)
            });
        }
        
        // Only log if there are files being uploaded
        if (uploadedFileIds.size > 0) {
            console.log('📤 ChatKit message with files:', {
                vectorStoreId: vectorStoreId || 'NONE',
                uploadedFiles: uploadedFileIds.size
            });
        }
        
        // Send message using ChatKit API - NO file attachments, files are in vector store
        const messagePayload = {
            session_id: effectiveSessionId,
            role: 'user',
            content: content
        };
        // NOTE: We intentionally do NOT add attachments here - files are retrieved via vector store

        const message = await client.beta.chatkit.messages.create(messagePayload);
        
        // Silent on success - only log errors

        // Clear session-stashed files after sending (legacy cleanup)
        try {
            if (Array.isArray(req.session.chatkitFileIds)) {
                req.session.chatkitFileIds = [];
            }
        } catch (e) {
            console.warn('Unable to clear session file_ids:', e?.message);
        }

        try {
            if (req.session.chatkitFilesMetadata && injectedFileIds.size > 0) {
                for (const fid of injectedFileIds) {
                    delete req.session.chatkitFilesMetadata[fid];
                }
            }
        } catch (e) {
            console.warn('Unable to clear session file metadata:', e?.message);
        }

        // Generate the assistant's reply (visible to the user)
        // store: true ensures logs are stored in OpenAI Platform (default behavior)
        // Note: If Zero Data Retention (ZDR) is enabled at org level, store will be treated as false
        const responseConfig = {
            session_id: effectiveSessionId,
            store: true  // Explicitly enable logging - logs stored for up to 30 days
        };

        // Add file_search tool with vector store if available
        const vectorStoreIdForResponse = req.session?.vectorStoreId;
        if (vectorStoreIdForResponse) {
            responseConfig.tool_resources = {
                file_search: {
                    vector_store_ids: [vectorStoreIdForResponse]
                }
            };
            // Only log if files are present or if there's an issue
        } else if (uploadedFileIds.size > 0) {
            console.warn('⚠️ ChatKit: Files uploaded but no vector store available for file_search');
        }

        const response = await client.beta.chatkit.responses.create(responseConfig);

        // Silent on success - only log errors
        
        res.json({
            success: true,
            message_id: message.id,
            response_id: response.id
        });
    } catch (error) {
        console.error('Failed to send ChatKit message:', error?.response?.data ?? error);
        res.status(500).json({ 
            error: 'Failed to send message to ChatKit', 
            details: error?.response?.data ?? error?.message ?? String(error)
        });
    }
});

app.get('/api/sdk/conversation', requireAuth, checkUserPermissions, (req, res) => {
    try {
        if (!Array.isArray(req.session.sdkConversation)) {
            req.session.sdkConversation = [];
        }

        res.json({
            conversation: req.session.sdkConversation,
        });
    } catch (error) {
        console.error('Failed to load SDK conversation:', error);
        res.status(500).json({ error: 'Failed to load conversation history' });
    }
});

app.post('/api/sdk/conversation/reset', requireAuth, checkUserPermissions, (req, res) => {
    try {
        req.session.sdkConversation = [];
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to reset SDK conversation:', error);
        res.status(500).json({ error: 'Failed to reset conversation history' });
    }
});

app.post('/api/sdk/message', requireAuth, checkUserPermissions, async (req, res) => {
    try {
        const { text, staged_file_ids, staged_files } = req.body || {};
        const trimmedText = typeof text === 'string' ? text.trim() : '';
        const fileIds = Array.isArray(staged_file_ids)
            ? staged_file_ids.filter((fid) => typeof fid === 'string' && fid.trim())
            : [];

        if (!trimmedText && fileIds.length === 0) {
            return res.status(400).json({ error: 'Either text or staged_file_ids is required' });
        }

        // Ensure vector store exists for SDK conversations
        let vectorStoreId = null; // Declare in outer scope so it's available throughout the function
        const client = getOpenAIClient();
        if (client) {
            try {
                const userId = req.session.user?.id || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const sdkSessionId = `sdk_${userId}_${req.sessionID}`;
                vectorStoreId = await getOrCreateVectorStore(client, req.session, sdkSessionId, userId);
                // Ensure session has the vector store ID
                if (vectorStoreId && !req.session.vectorStoreId) {
                    req.session.vectorStoreId = vectorStoreId;
                }
            } catch (vectorStoreError) {
                console.error('❌ SDK: Failed to ensure vector store:', {
                    error: vectorStoreError?.message,
                    stack: vectorStoreError?.stack,
                    name: vectorStoreError?.name
                });
                // Try to fall back to session-stored vector store ID
                vectorStoreId = req.session?.vectorStoreId || null;
                if (vectorStoreId) {
                    console.log('⚠️ SDK: Falling back to session-stored vectorStoreId:', vectorStoreId);
                }
                // Continue anyway - files may still work without vector store
            }
        } else {
            console.error('❌ SDK: OpenAI client not available for vector store creation');
            // Try to fall back to session-stored vector store ID
            vectorStoreId = req.session?.vectorStoreId || null;
        }
        
        // Build file metadata map from staged_files and session
        const fileMetadataMap = new Map();
        
        console.log('SDK message - Building file metadata map:', {
            fileIds,
            staged_files_count: Array.isArray(staged_files) ? staged_files.length : 0,
            session_metadata_keys: req.session.chatkitFilesMetadata ? Object.keys(req.session.chatkitFilesMetadata) : []
        });
        
        // First, load from staged_files if provided by client
        if (Array.isArray(staged_files)) {
            staged_files.forEach(fileData => {
                if (fileData && fileData.file_id) {
                    console.log('SDK message - Adding from staged_files:', fileData);
                    fileMetadataMap.set(fileData.file_id, fileData);
                }
            });
        }
        
        // Then, overlay with session metadata if available
        if (req.session.chatkitFilesMetadata) {
            Object.entries(req.session.chatkitFilesMetadata).forEach(([fileId, metadata]) => {
                if (fileIds.includes(fileId)) {
                    console.log('SDK message - Adding from session:', { fileId, metadata });
                    fileMetadataMap.set(fileId, {
                        file_id: fileId,
                        ...metadata
                    });
                }
            });
        }
        
        console.log('SDK message - Final file metadata map:', Array.from(fileMetadataMap.entries()));

        const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const generateToolCallId = () => `mcpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const normalizeConversationItem = (item) => {
            if (!item || typeof item !== 'object') {
                console.warn('SDK: Skipping non-object conversation item:', item);
                return null;
            }

            const normalized = { ...item };
            const existingId = typeof normalized.id === 'string' ? normalized.id.trim() : '';
            const itemType = normalized.type || null;
            const itemRole = normalized.role || null;
            const isToolCall = itemType === 'hosted_tool_call' || itemRole === 'tool';
            const isRecognizedId = (id) => {
                if (typeof id !== 'string' || !id) return false;
                return id.startsWith('msg_') || id.startsWith('mcp');
            };
            
            // Ensure ID is valid
            if (existingId) {
                if (isToolCall) {
                    normalized.id = existingId;
                } else if (isRecognizedId(existingId)) {
                    normalized.id = existingId;
                } else if (itemRole === 'user' || itemRole === 'assistant' || itemRole === 'system') {
                    normalized.id = generateMessageId();
                } else {
                    normalized.id = existingId;
                }
            } else {
                normalized.id = isToolCall ? generateToolCallId() : generateMessageId();
            }

            // Handle content based on type
            if (Array.isArray(normalized.content)) {
                // Filter out any undefined/null entries and validate structure
                const validContent = normalized.content
                    .filter((entry) => {
                        // Silently filter invalid entries (historical data cleanup)
                        if (!entry || typeof entry !== 'object') {
                            return false;
                        }
                        return true;
                    })
                    .map((entry) => {
                        const cloned = { ...entry };
                        if (entry.file && typeof entry.file === 'object') {
                            cloned.file = { ...entry.file };
                        }
                        if (entry.image && typeof entry.image === 'object') {
                            cloned.image = { ...entry.image };
                        }
                        return cloned;
                    });
                
                // If content array becomes empty after filtering, convert to empty string
                if (validContent.length === 0) {
                    // Silent normalization of historical data
                    normalized.content = '';
                } else {
                    normalized.content = validContent;
                }
            } else if (typeof normalized.content !== 'string') {
                // Content must be either string or array - silently normalize historical data
                normalized.content = String(normalized.content || '');
            }

            return normalized;
        };

        const conversation = Array.isArray(req.session.sdkConversation)
            ? req.session.sdkConversation
                .map(normalizeConversationItem)
                .filter(Boolean)
            : [];

        // For the OpenAI Agents SDK, use vector store file_search for files
        // NO message-level file attachments - files are accessed via vector store
        let userItem;
        
        // Use vectorStoreId from above (or fall back to session)
        if (!vectorStoreId) {
            vectorStoreId = req.session?.vectorStoreId || null;
        }
        
        // Verify vector store exists and log file availability
        if (vectorStoreId && fileIds.length > 0) {
            try {
                const client = getOpenAIClient();
                let vs;
                if (client?.beta?.vectorStores) {
                    vs = await client.beta.vectorStores.retrieve(vectorStoreId);
                } else {
                    // Fallback to HTTP API
                    const apiKey = process.env.OPENAI_API_KEY;
                    vs = await retrieveVectorStoreViaHTTP(vectorStoreId, apiKey);
                }
                console.log('📁 SDK: Files will be retrieved via vector store file_search:', {
                    vectorStoreId,
                    uploadedFileCount: fileIds.length,
                    vectorStoreFileCount: vs.file_counts?.total || 0,
                    uploadedFileIds: fileIds
                });
            } catch (e) {
                console.warn('⚠️ SDK: Could not verify vector store, but continuing:', e?.message);
            }
        } else if (fileIds.length > 0) {
            console.warn('⚠️ SDK: Files uploaded but no vector store available');
        }
        
        // Use simple string content - files are accessed via vector store, not message attachments
        userItem = {
            role: 'user',
            content: trimmedText || '', // Simple string - files accessed via vector store
            createdAt: new Date().toISOString(),
            id: generateMessageId()
        };
        
        // Only log if there are files
        if (fileIds.length > 0) {
            console.log('📤 SDK message with files:', {
                vectorStoreId: vectorStoreId || 'NONE',
                uploadedFiles: fileIds.length
            });
        }

        conversation.push(userItem);

        // Clean conversation for OpenAI Agents SDK - send ONLY the current user message
        // NO file attachments - files are accessed via vector store file_search tool
        const cleanedMessage = { role: 'user' };
        
        // Content is always a simple string - files accessed via vector store
        cleanedMessage.content = typeof userItem.content === 'string' 
            ? userItem.content 
            : '';
        
        // Ensure we have non-empty content - if empty and files exist, add a hint
        if (!cleanedMessage.content && fileIds.length > 0) {
            cleanedMessage.content = 'Please analyze the uploaded files.';
        }
        
        // NOTE: We intentionally do NOT add attachments - files are retrieved via vector store
        
        const cleanedConversation = [cleanedMessage];

        // Vector store ID already retrieved above - use it for agent
        if (vectorStoreId) {
            // Only log if there are files
            if (fileIds.length > 0) {
                console.log('✅ SDK: Using vector store for file awareness:', {
                    vectorStoreId,
                    fileCount: fileIds.length
                });
            }
        } else if (fileIds.length > 0) {
            console.warn('⚠️ SDK: Files uploaded but no vector store available');
        }

        const agentResult = await runAgentConversation(cleanedConversation, 'SDK Conversation', vectorStoreId);

        if (Array.isArray(agentResult?.newItems) && agentResult.newItems.length > 0) {
            const normalizedAgentItems = agentResult.newItems
                .map(normalizeConversationItem)
                .filter(Boolean);
            if (normalizedAgentItems.length > 0) {
                conversation.push(...normalizedAgentItems);
            }
        }

        req.session.sdkConversation = conversation;

        res.json({
            conversation,
            final_output: agentResult?.finalOutput ?? null,
            guardrail_results: agentResult?.guardrailResults ?? null,
            usage: agentResult?.usage ?? null,
        });
    } catch (error) {
        console.error('Failed to process SDK message:', error);
        try {
            console.error('SDK message failure payload:', JSON.stringify(req.session.sdkConversation, null, 2));
        } catch (logError) {
            console.error('Unable to stringify SDK conversation for diagnostics:', logError);
        }
        res.status(500).json({
            error: 'Failed to process message',
            details: error?.message || 'Unknown error',
        });
    }
});

// ============ Access Log API Endpoints ============
// Get access logs for a specific user (admin only)
app.get('/api/admin/access-logs/:userId', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
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
app.get('/api/admin/access-logs', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
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
app.get('/api/admin/access-stats', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
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
app.get('/api/admin/users', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
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
app.get('/api/admin/users/search-names', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
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

// Update user data (admin only)
app.post('/api/admin/users/update', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
    try {
        const { users } = req.body;
        
        if (!users || !Array.isArray(users)) {
            return res.status(400).json({ error: 'Invalid request: users array required' });
        }
        
        const updatePromises = users.map(async (userUpdate) => {
            const { email, userType } = userUpdate;
            
            if (!email || !userType) {
                throw new Error('Email and userType are required for each user update');
            }
            
            // Prevent changes to colin@kyocare.com user type
            if (email === 'colin@kyocare.com') {
                throw new Error('User Type for colin@kyocare.com cannot be modified');
            }
            
            // Validate user type
            const { isValidUserType } = require('./constants.js');
            if (!isValidUserType(userType)) {
                throw new Error(`Invalid user type: ${userType}`);
            }
            
            // Update user type in the users table
            const updateSQL = `
                UPDATE users 
                SET user_type = $1, updated_at = CURRENT_TIMESTAMP
                WHERE email = $2 
                AND user_type IS DISTINCT FROM $1
            `;
            
            const result = await loggingConfig.logger.pool.query(updateSQL, [userType, email]);
            
            return {
                email,
                userType,
                rowsAffected: result.rowCount
            };
        });
        
        const results = await Promise.all(updatePromises);
        
        // Log the admin action
        const clientInfo = getClientInfo(req);
        await loggingConfig.logAccess({
            userId: req.session.user.id,
            email: req.session.user.email,
            eventType: 'admin_user_update',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID,
            metadata: {
                action: 'update_user_types',
                updatedUsers: results,
                totalUpdated: results.length
            }
        });
        
        res.json({
            success: true,
            message: `Successfully updated ${results.length} user(s)`,
            results: results
        });
        
    } catch (error) {
        console.error('Failed to update users:', error);
        res.status(500).json({ 
            error: 'Failed to update users', 
            details: error.message 
        });
    }
});

// List S3 objects (admin only)
app.get('/api/admin/s3/objects', requireAuth, checkUserPermissions, requireAdmin, async (req, res) => {
    try {
        const bucketName = process.env.S3_BUCKET_NAME;
        const region = process.env.AWS_REGION || 'us-east-1';

        if (!bucketName) {
            return res.status(500).json({ success: false, error: 'S3_BUCKET_NAME is not configured' });
        }

        const s3 = new AWS.S3({ region });

        async function listAllObjects() {
            let all = [];
            let continuationToken = undefined;
            do {
                const params = { Bucket: bucketName };
                if (continuationToken) params.ContinuationToken = continuationToken;
                const resp = await s3.listObjectsV2(params).promise();
                all = all.concat(resp.Contents || []);
                continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
            } while (continuationToken);
            return all;
        }

        const contents = await listAllObjects();

        const objects = contents.map(obj => {
            const url = s3.getSignedUrl('getObject', {
                Bucket: bucketName,
                Key: obj.Key,
                Expires: 3600
            });
            return {
                name: obj.Key,
                url: url,
                creationDate: obj.LastModified
            };
        });

        res.json({ success: true, bucket: bucketName, objects });
    } catch (error) {
        console.error('Failed to list S3 objects:', error);
        res.status(500).json({ success: false, error: 'Failed to list S3 objects' });
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

// Serve menu-bar.js file
app.get('/menu-bar.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'menu-bar.js'));
});

// Serve menu-bar.css file
app.get('/menu-bar.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, 'menu-bar.css'));
});

// Serve robots.txt file
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile(path.join(__dirname, 'robots.txt'));
});

// ============ HTML Page Routes ============
// Login page route
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Homepage route - check permissions and redirect based on user type
app.get('/homepage', requireAuth, checkUserPermissions, (req, res) => {
    const userType = req.session.user.userType || req.session.userType;
    
    if (userType === 'New') {
        // Redirect New users to the restricted page
        return res.redirect('/new-user-home');
    }
    
    // Admin and Standard users see the normal homepage
    res.sendFile(path.join(__dirname, 'homepage.html'));
});

// Admin menu route - require admin access
app.get('/admin', requireAuth, checkUserPermissions, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-menu.html'));
});

// Admin access log route - require admin access
app.get('/admin/access-log', requireAuth, checkUserPermissions, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Admin users route - require admin access
app.get('/admin/users', requireAuth, checkUserPermissions, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-users.html'));
});

// Admin S3 route - require admin access
app.get('/admin/s3', requireAuth, checkUserPermissions, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-s3.html'));
});

// New User Home route - for users with 'New' type
app.get('/new-user-home', requireAuth, checkUserPermissions, (req, res) => {
    const userType = req.session.user.userType || req.session.userType;
    
    // Only allow New users to access this page
    if (userType !== 'New') {
        return res.redirect('/homepage');
    }
    
    res.sendFile(path.join(__dirname, 'new-user-home.html'));
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
// Redirect to appropriate page based on authentication and user type
app.get('/', async (req, res) => {
    if (req.session.user) {
        try {
            const userType = await getUserType(req.session.user.email);
            req.session.user.userType = userType;
            req.session.userType = userType;
            
            if (userType === 'New') {
                res.redirect('/new-user-home');
            } else {
                res.redirect('/homepage');
            }
        } catch (error) {
            console.error('Error checking user type in root route:', error);
            res.redirect('/homepage');
        }
    } else {
        res.redirect('/login');
    }
});

// Chat interface route - serve React app (restricted to Admin and Standard users)
app.get('/chat', requireAuth, checkUserPermissions, (req, res) => {
    const userType = req.session.user.userType || req.session.userType;
    
    // Block New users from accessing chat
    if (userType === 'New') {
        return res.redirect('/new-user-home');
    }
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Chat SDK interface route - serve React SDK app (restricted to Admin and Standard users)
app.get('/chat-sdk', requireAuth, checkUserPermissions, (req, res) => {
    const userType = req.session.user.userType || req.session.userType;
    
    // Block New users from accessing chat
    if (userType === 'New') {
        return res.redirect('/new-user-home');
    }
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'dist', 'indexSDK.html'));
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Chat interface server running on port ${PORT}`);
    console.log(`📱 Access your chat at: http://localhost:${PORT}`);
    console.log(`🔐 AWS Cognito authentication enabled for kyocare.com domain`);
});