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

// Run database migration for Google OAuth attributes (non-blocking)
const runMigration = async () => {
    try {
        // Only run migration if using PostgreSQL logger
        if (loggingConfig.loggerType !== 'postgresql') {
            console.log('Skipping migration - not using PostgreSQL logger');
            return;
        }

        // Check if logger has pool property (PostgreSQL logger)
        if (!loggingConfig.logger || !loggingConfig.logger.pool) {
            console.log('Logger not ready for migration, skipping...');
            return;
        }

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
        console.error('Migration check failed (non-critical):', error.message);
        console.error('Stack:', error.stack);
        // Don't fail the app startup if migration fails
    }
};

// Run migration on startup (non-blocking - don't await)
runMigration().catch(err => {
    console.error('Migration failed to start (non-critical):', err.message);
});

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
                    enabled: true
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
        // Persist the latest ChatKit session id in the user's server session for reuse/fallbacks
        try {
            req.session.chatkitSessionId = sessionId;
        } catch (e) {
            console.warn('Unable to persist chatkitSessionId in session (POST):', e?.message);
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
                    enabled: true
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

        const safeContentType = (mime && typeof mime === 'string' && mime.trim() !== '')
            ? mime
            : 'application/octet-stream';

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
            ContentType: safeContentType
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
            objectKey
        });
    } catch (error) {
        console.error('Failed to presign S3 upload:', error);
        res.status(500).json({ error: 'Failed to presign upload', details: error.message });
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

        // Quiet ingest: stash file_id in the user's session for later injection
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
        const { session_id, file_id, text } = req.body || {};
        
        // Prefer explicit session_id from the client; fall back to the server-stored session id
        const effectiveSessionId = session_id || req.session?.chatkitSessionId;
        if (!effectiveSessionId) {
            return res.status(400).json({ error: 'session_id is required and no fallback session found on server' });
        }
        
        if (!file_id && !text) {
            return res.status(400).json({ error: 'Either file_id or text (or both) is required' });
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
        
        // Build content array; quietly inject all stashed files for this session
        const content = [];
        if (text) {
            content.push({ type: 'input_text', text: text });
        }

        const injectedFileIds = new Set();
        if (Array.isArray(req.session?.chatkitFileIds)) {
            for (const fid of req.session.chatkitFileIds) {
                if (typeof fid === 'string' && fid.trim()) {
                    injectedFileIds.add(fid);
                }
            }
        }
        if (file_id && typeof file_id === 'string') {
            injectedFileIds.add(file_id);
        }
        for (const fid of injectedFileIds) {
            content.push({ type: 'input_file', file_id: fid });
        }
        
        console.log('Sending message to ChatKit session:', {
            session_id: effectiveSessionId,
            contentTypes: content.map(c => c.type),
            injectedFiles: Array.from(injectedFileIds),
            hasText: !!text,
            hasFile: !!file_id
        });
        
        // Send message using ChatKit API
        const message = await client.beta.chatkit.messages.create({
            session_id: effectiveSessionId,
            role: 'user',
            content: content
        });
        
        console.log('Message sent successfully:', {
            message_id: message.id,
            session_id: effectiveSessionId
        });
        
        res.json({
            success: true,
            message_id: message.id
        });
    } catch (error) {
        console.error('Failed to send ChatKit message:', error?.response?.data ?? error);
        res.status(500).json({ 
            error: 'Failed to send message to ChatKit', 
            details: error?.response?.data ?? error?.message ?? String(error)
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

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Chat interface server running on port ${PORT}`);
    console.log(`📱 Access your chat at: http://localhost:${PORT}`);
    console.log(`🔐 AWS Cognito authentication enabled for kyocare.com domain`);
});