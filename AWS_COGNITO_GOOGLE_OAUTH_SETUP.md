# AWS Cognito Google OAuth Setup Guide

This guide shows you how to configure Google OAuth through your existing AWS Cognito setup, which will give you the exact Google OAuth consent screen you want without needing separate Google Cloud Console credentials.

## How It Works

AWS Cognito can act as a federated identity provider, allowing you to use Google OAuth through Cognito's hosted UI. This means:
- Users see Google's OAuth consent screen
- Google handles the authentication
- Cognito manages the user session
- You maintain your existing @kyocare.com domain restriction

## Step 1: Configure Google as Identity Provider in AWS Cognito

### 1.1 Go to AWS Cognito Console

1. Navigate to the [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
2. Select your existing User Pool (the one with ID: `us-east-1_WuzfoISRw`)
3. Go to **Sign-in experience** tab
4. Click **Add identity provider**

### 1.2 Configure Google Identity Provider

1. **Provider type**: Select "Google"
2. **Provider name**: `Google` (or any name you prefer)
3. **Client ID**: You'll need to get this from Google Cloud Console (see Step 2)
4. **Client secret**: You'll need to get this from Google Cloud Console (see Step 2)
5. **Authorize scopes**: `email`, `profile`, `openid`
6. **Attribute mapping**:
   - **Email**: `email`
   - **Name**: `name`
   - **Username**: `email` (this ensures username is the email)

### 1.3 Configure App Client Settings

1. Go to **App integration** tab
2. Select your app client
3. **Hosted authentication pages**: Enable
4. **Identity providers**: Enable "Google" (the one you just created)
5. **OAuth 2.0 grant types**: Enable "Authorization code grant"
6. **OpenID Connect scopes**: Enable `email`, `openid`, `profile`
7. **Callback URLs**: 
   - Development: `http://localhost:3000/auth/cognito/callback`
   - Production: `https://yourdomain.com/auth/cognito/callback`
8. **Sign-out URLs**:
   - Development: `http://localhost:3000/login`
   - Production: `https://yourdomain.com/login`

## Step 2: Get Google OAuth Credentials

### 2.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google+ API (or Google Identity API)

### 2.2 Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type
3. Fill in required information:
   - **App name**: Your application name
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Add your domain to **Authorized domains** (optional)
5. Save and continue

### 2.3 Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth 2.0 Client IDs**
3. Choose **Web application**
4. Configure:
   - **Name**: AWS Cognito Google OAuth
   - **Authorized JavaScript origins**: 
     - `https://your-cognito-domain.auth.us-east-1.amazoncognito.com`
   - **Authorized redirect URIs**:
     - `https://your-cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 3: Update Your Application

### 3.1 Install Required Dependencies

```bash
npm install amazon-cognito-identity-js
```

### 3.2 Update Environment Variables

Add these to your `.env` file:

```env
# AWS Cognito Configuration (existing)
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_WuzfoISRw
COGNITO_CLIENT_ID=6h307650vrg74mdgc5m182jg99
COGNITO_DOMAIN=https://us-east-1wuzfoisrw.auth.us-east-1.amazoncognito.com

# Google OAuth through Cognito
COGNITO_HOSTED_UI_DOMAIN=your-cognito-domain.auth.us-east-1.amazoncognito.com
COGNITO_REDIRECT_URI=http://localhost:3000/auth/cognito/callback
```

### 3.3 Update Server Routes

Add these routes to your `server.js`:

```javascript
// AWS Cognito Hosted UI Routes
app.get('/auth/cognito', (req, res) => {
    const cognitoDomain = process.env.COGNITO_HOSTED_UI_DOMAIN;
    const clientId = process.env.COGNITO_CLIENT_ID;
    const redirectUri = process.env.COGNITO_REDIRECT_URI;
    
    const authUrl = `https://${cognitoDomain}/oauth2/authorize?` +
        `client_id=${clientId}&` +
        `response_type=code&` +
        `scope=email+openid+profile&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    res.redirect(authUrl);
});

app.get('/auth/cognito/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.redirect('/login?error=no_code');
        }
        
        // Exchange code for tokens
        const tokenResponse = await fetch(`https://${process.env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.COGNITO_CLIENT_ID,
                code: code,
                redirect_uri: process.env.COGNITO_REDIRECT_URI,
            }),
        });
        
        const tokens = await tokenResponse.json();
        
        if (tokens.error) {
            return res.redirect('/login?error=token_exchange_failed');
        }
        
        // Get user info from Cognito
        const userResponse = await fetch(`https://${process.env.COGNITO_HOSTED_UI_DOMAIN}/oauth2/userInfo`, {
            headers: {
                'Authorization': `Bearer ${tokens.access_token}`,
            },
        });
        
        const userInfo = await userResponse.json();
        
        // Check domain restriction
        const email = userInfo.email;
        const domain = email.split('@')[1];
        
        if (domain !== 'kyocare.com') {
            return res.redirect('/login?error=access_denied');
        }
        
        // Store user in session
        req.session.user = {
            id: userInfo.sub,
            email: userInfo.email,
            name: userInfo.name,
            avatar: userInfo.picture
        };
        
        // Log successful login
        const clientInfo = getClientInfo(req);
        loggingConfig.logAccess({
            userId: req.session.user.id,
            email: req.session.user.email,
            eventType: 'login',
            ipAddress: clientInfo.ipAddress,
            userAgent: clientInfo.userAgent,
            sessionId: req.sessionID,
            metadata: {
                authMethod: 'cognito_google_oauth',
                domain: domain,
                isProduction: isProduction
            }
        });
        
        res.redirect('/');
        
    } catch (error) {
        console.error('Cognito OAuth callback error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});
```

### 3.4 Update Login Page

Add a Google OAuth button to your `login.html`:

```html
<!-- Add this before your existing form -->
<div class="oauth-section">
    <a href="/auth/cognito" class="google-oauth-btn">
        <div class="google-icon">
            <svg width="20" height="20" viewBox="0 0 24 24">
                <!-- Google logo SVG -->
            </svg>
        </div>
        Sign in with Google
    </a>
</div>

<div class="divider">
    <span>or</span>
</div>
```

## Step 4: Test the Integration

1. Start your application: `npm start`
2. Navigate to `http://localhost:3000/login`
3. Click "Sign in with Google"
4. You should see the Google OAuth consent screen
5. After authentication, you'll be redirected back to your app

## Benefits of This Approach

1. **No separate Google credentials needed** - Cognito handles everything
2. **Consistent user management** - All users go through Cognito
3. **Domain restriction maintained** - Your @kyocare.com restriction still works
4. **Google OAuth UI** - Users see the exact Google interface you want
5. **Scalable** - Easy to add more identity providers later

## Production Deployment

When deploying to production:

1. Update callback URLs in Cognito:
   - `https://yourdomain.com/auth/cognito/callback`

2. Update environment variables:
   ```env
   COGNITO_REDIRECT_URI=https://yourdomain.com/auth/cognito/callback
   ```

3. Ensure your domain is added to Google Cloud Console authorized domains

## Troubleshooting

### Common Issues

1. **"redirect_uri_mismatch"**: Check that your callback URL in Cognito matches your environment variable
2. **"access_denied"**: Verify domain restriction is working correctly
3. **"invalid_client"**: Ensure your Cognito app client is configured correctly

### Debug Mode

Add this to see detailed OAuth flow:
```javascript
console.log('OAuth URL:', authUrl);
console.log('Callback code:', code);
console.log('User info:', userInfo);
```

This approach gives you the exact Google OAuth consent screen you want while maintaining your existing AWS Cognito infrastructure and domain restrictions!
