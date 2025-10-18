# AWS Cognito Setup Instructions

This chat application now includes AWS Cognito authentication with domain restriction for kyocare.com users.

## Prerequisites

1. An AWS account with appropriate permissions
2. Node.js installed on your system
3. The application dependencies installed

## AWS Cognito Setup

### 1. Create a Cognito User Pool

1. Go to the [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
2. Click "Create user pool"
3. Choose "Cognito user pool" (not "Federated identity")
4. Configure the user pool:
   - **Sign-in options**: Email
   - **Password policy**: Set according to your requirements
   - **MFA**: Optional, but recommended for security
   - **User account recovery**: Email only
   - **Required attributes**: Email
   - **Custom attributes**: None needed for basic setup

### 2. Configure App Integration

1. In the "App integration" section:
   - **App client name**: "Chat Application"
   - **Client secret**: Generate a client secret (recommended)
   - **Authentication flows**: ALLOW_USER_SRP_AUTH, ALLOW_USER_PASSWORD_AUTH
   - **OAuth 2.0 grant types**: Authorization code grant
   - **OpenID Connect scopes**: email, openid, profile
   - **Callback URLs**: 
     - For development: `http://localhost:3000`
     - For production: `https://yourdomain.com`
   - **Sign-out URLs**: 
     - For development: `http://localhost:3000/login`
     - For production: `https://yourdomain.com/login`

### 3. Configure Domain

1. In the "Domain" section:
   - Choose "Use a Cognito domain"
   - Enter a unique domain prefix (e.g., `your-chat-app`)
   - This will create a domain like: `your-chat-app.auth.us-east-1.amazoncognito.com`

### 4. Environment Configuration

1. Copy the `env.example` file to `.env`:
   ```bash
   cp env.example .env
   ```

2. Update the `.env` file with your Cognito details:
   ```
   AWS_REGION=us-east-1
   COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
   COGNITO_CLIENT_ID=your_cognito_client_id
   COGNITO_DOMAIN=your-chat-app.auth.us-east-1.amazoncognito.com
   SESSION_SECRET=your_session_secret_here
   ALLOWED_DOMAIN=kyocare.com
   ```

3. Generate a secure session secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

## Installation and Running

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the application:
   ```bash
   npm start
   ```

3. Open your browser and navigate to `http://localhost:3000`

## Features

- **AWS Cognito Authentication**: Users must sign in with their Cognito account
- **Domain Restriction**: Only users with @kyocare.com email addresses can access the application
- **Session Management**: Secure session handling with automatic logout
- **User Interface**: Shows user profile photo, name, and logout option
- **Protected Routes**: All routes require authentication

## Security Notes

- The application checks the email domain on the server side
- Sessions are managed securely with express-session
- In production, ensure you use HTTPS and set `cookie.secure: true`
- Change the SESSION_SECRET to a secure random string
- AWS Cognito provides additional security features like MFA, password policies, etc.

## Troubleshooting

### Common Issues

1. **"Access denied" error**: Make sure the user's email domain is exactly `kyocare.com`
2. **Cognito configuration**: Ensure your User Pool ID, Client ID, and domain are correct
3. **Session not persisting**: Check that SESSION_SECRET is set and consistent
4. **Authentication flow**: Verify that the authentication flows are enabled in Cognito

### Development vs Production

- **Development**: Use `http://localhost:3000` for callback URLs
- **Production**: Use your actual domain with HTTPS
- Update the callback URLs in Cognito when deploying

## API Endpoints

- `GET /` - Main chat interface (requires authentication)
- `GET /login` - Login page
- `POST /auth/login` - Authenticate user with email/password
- `GET /auth/logout` - Logout user
- `GET /api/user` - Get current user info (requires authentication)
- `GET /health` - Health check endpoint

## Next Steps for Production

1. **Integrate with actual Cognito authentication**: The current implementation is a simplified version. For production, you'll want to:
   - Use the AWS Cognito SDK for actual authentication
   - Implement proper JWT token validation
   - Add proper error handling for Cognito responses

2. **Add user management**: Consider adding features like:
   - User registration
   - Password reset
   - Email verification
   - User profile management

3. **Enhanced security**: 
   - Enable MFA in Cognito
   - Implement proper session management
   - Add rate limiting
   - Use HTTPS in production
