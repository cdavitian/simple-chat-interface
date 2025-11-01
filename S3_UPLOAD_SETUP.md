# S3 Upload Setup Guide

This guide covers the external configuration needed for the S3-presigned upload strategy to work with ChatKit file uploads.

## Overview

Our implementation follows the recommended pattern:
1. **Frontend** → Get presigned PUT URL from server
2. **Frontend** → Upload file directly to S3
3. **Frontend** → Server imports from S3 to OpenAI Files API
4. **Frontend** → Message sent with `file_id` (not base64 data)

## Required External Configuration

### 1. S3 CORS Configuration

In your S3 bucket **Permissions → CORS**, add this JSON configuration:

```json
[
  {
    "AllowedOrigins": [
      "https://simple-chat-interface-production.up.railway.app",
      "https://simple-chat-interface-staging.up.railway.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-version-id"],
    "MaxAgeSeconds": 3000
  }
]
```

**Why needed:** Allows browser-based PUT uploads from your frontend domains.

### 2. IAM Permissions

Attach this policy to the IAM role/user your server uses (adjust bucket name as needed):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

**Why needed:**
- `PutObject` - Server generates presigned upload URLs
- `GetObject` - Server reads uploaded files to stream to OpenAI Files API

### 3. Environment Variables

Add to your `.env` file (or Railway environment):

```bash
# Required
S3_BUCKET_NAME=your-bucket-name

# Optional (defaults shown)
S3_CHATKIT_UPLOAD_PREFIX=chatkit-uploads
S3_CHATKIT_MAX_FILE_BYTES=20971520
S3_CHATKIT_UPLOAD_URL_TTL=900
S3_CHATKIT_DOWNLOAD_URL_TTL=3600
```

## Implementation Details

### Backend Endpoints

1. **`POST /api/uploads/presign`** - Returns presigned upload URL
   - Input: `{ filename, mime, size }`
   - Output: `{ uploadUrl, objectKey }`

2. **`POST /api/openai/import-s3`** - Imports S3 object to OpenAI Files API
   - Input: `{ objectKey, filename, purpose }`
   - Output: `{ file_id }`

### Frontend Flow

1. User clicks "📎 Upload File" button
2. File is uploaded to S3 via presigned URL
3. Server imports file from S3 to OpenAI Files API
4. Returns `file_id` to frontend
5. User can reference the file in their messages

## Verification Checklist

- [ ] S3 CORS configured for your domains
- [ ] IAM permissions attached to server credentials
- [ ] Environment variables set
- [ ] Test upload: File uploads to S3 without CORS errors
- [ ] Test import: Server successfully creates OpenAI file (returns `file_id`)
- [ ] Test in ChatKit: Messages can reference the `file_id`

## Common Issues

### "CORS preflight failed"
- Check S3 CORS includes PUT method and your origin
- Verify origins match exactly (https vs http, trailing slashes)

### "Access Denied" on presign
- Check IAM role has `s3:PutObject` permission
- Verify AWS credentials are set in environment

### "Failed to import from S3"
- Check IAM role has `s3:GetObject` permission
- Verify `objectKey` matches what was returned from presign

### "Unsupported MIME type"
- This usually means you're sending `file_data` instead of `file_id`
- Ensure you're using the S3→Files API flow, not base64

## File Size Limits

- **S3**: No practical limit for our use case
- **OpenAI Files API**: 
  - Max 512MB per file
  - CSV typically ~50MB recommended for Code Interpreter
- **Browser**: Depends on available memory

## Security Notes

- Presigned URLs expire after configured time (default: 15 minutes)
- Files are namespaced by user ID in S3
- Bucket should remain private (no public access)
- Access only via presigned URLs

## References

- [OpenAI Files API Documentation](https://platform.openai.com/docs/api-reference/files)
- [AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [ChatKit Documentation](https://platform.openai.com/docs/guides/chatkit)

