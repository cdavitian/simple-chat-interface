# Railway Environment Variables

This document lists all environment variables that need to be configured in your Railway project for the chat application to work correctly.

## Required Environment Variables

### 1. OpenAI Configuration

These are **REQUIRED** for ChatKit to work:

```bash
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
```
Your OpenAI API key from https://platform.openai.com/api-keys

```bash
OPENAI_CHATKIT_WORKFLOW_ID=wf_xxxxxxxxxxxxxxxxxxxxxxxxxx
```
Your ChatKit workflow ID from the ChatKit dashboard

```bash
OPENAI_CHATKIT_PUBLIC_KEY=domain_pk_xxxxxxxxxxxxxxxxxxxxxxxxxx
```
Your ChatKit public key from the ChatKit dashboard

### 2. Session Configuration (Optional but Recommended)

```bash
SESSION_SECRET=your-random-secure-secret-here
```
A random string for session encryption. Generate one using:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. AWS Cognito Configuration (Required for Authentication)

```bash
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_WuzfoISRw
COGNITO_CLIENT_ID=6h307650vrg74mdgc5m182jg99
COGNITO_DOMAIN=https://us-east-1wuzfoisrw.auth.us-east-1.amazoncognito.com
```

### 4. Google OAuth through Cognito (Required for Google Sign-in)

```bash
COGNITO_HOSTED_UI_DOMAIN=us-east-1wuzfoisrw.auth.us-east-1.amazoncognito.com
COGNITO_REDIRECT_URI=https://your-railway-domain.railway.app/auth/cognito/callback
```

**Important:** Replace `your-railway-domain.railway.app` with your actual Railway domain!

### 5. Domain Restriction (Required for Security)

```bash
ALLOWED_DOMAIN=kyocare.com
```

### 6. Session Configuration (Optional but Recommended)

```bash
SESSION_SECRET=your-random-secure-secret-here
```
A random string for session encryption. Generate one using:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 7. Production Environment (Optional)

```bash
NODE_ENV=production
```
Railway usually sets this automatically, but if not, add it manually.

## How to Set Variables in Railway

1. Go to your Railway project dashboard
2. Click on your service
3. Go to the "Variables" tab
4. Click "New Variable"
5. Add each variable listed above
6. Railway will automatically redeploy when you add/change variables

## Verifying Configuration

After setting the environment variables, check the Railway deployment logs:

- ✅ You should see: `"hasApiKey": true`
- ✅ You should see: `"workflowId": "wf_..."` 
- ✅ You should see: `"publicKey": "SET"`

If any show as false/NOT SET, double-check your environment variables in Railway.

## Getting ChatKit Credentials

If you don't have ChatKit credentials yet:

1. Go to https://platform.openai.com/
2. Navigate to the ChatKit section
3. Create a new workflow or use an existing one
4. Copy the Workflow ID
5. Generate a public key for your domain
6. Copy the public key

## Troubleshooting

**Error: "OpenAI API Key not configured"**
→ Make sure `OPENAI_API_KEY` is set in Railway variables

**Error: "ChatKit Workflow ID not configured"**
→ Make sure `OPENAI_CHATKIT_WORKFLOW_ID` is set in Railway variables

**Error: "OpenAI ChatKit Public Key not configured"**
→ Make sure `OPENAI_CHATKIT_PUBLIC_KEY` is set in Railway variables

**Sessions not persisting / keeps redirecting to login**
→ This should be fixed with the proxy configuration, but make sure Railway is using HTTPS

**Google OAuth not working / "OAuth configuration missing"**
→ Make sure `COGNITO_HOSTED_UI_DOMAIN` and `COGNITO_REDIRECT_URI` are set in Railway variables

**"redirect_uri_mismatch" error**
→ Check that `COGNITO_REDIRECT_URI` matches your Railway domain exactly (https://your-domain.railway.app/auth/cognito/callback)

**Google OAuth button not appearing**
→ Make sure all Cognito environment variables are set correctly

