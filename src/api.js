// API helper functions for file upload and registration

/**
 * Register an uploaded S3 object with OpenAI Files API
 * Called by the custom upload tool after a successful presigned PUT to S3
 */
export async function registerUploadedS3Object(params) {
  const { key, filename, bucket } = params;
  
  const r = await fetch('/api/files/ingest-s3', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, filename, bucket }),
  });
  
  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Failed to register S3 object: ${r.status} ${errorText}`);
  }
  
  return r.json(); // { file_id, filename }
}

