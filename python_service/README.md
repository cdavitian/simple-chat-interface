# Python ChatKit Session Service

Minimal FastAPI service to call ChatKit Sessions API (preferred path for sessions).

## Requirements
- Python 3.9+
- `OPENAI_API_KEY` set in the environment
- (Optional) PostgreSQL database connection using Railway variable names:
  - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_SSL`
  - Database access is optional - service works without it

## Install
```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run Locally
```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

## Deploy to Railway

1. **Create a new Railway service** for the Python app
2. **Connect your repo** (or point to `python_service/` directory)
3. **Set environment variables:**
   - `OPENAI_API_KEY` (required)
   - (Optional) Shared PostgreSQL database (uses Railway variable names):
     - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_SSL`
     - These are automatically shared if both services are in the same Railway project
     - Database access is optional - service works without it
4. **Railway will auto-detect Python** and use the `Procfile`
5. **Get the URL for your Node service:**
   - Go to Settings → Networking in your Python service
   - **Recommended (internal network):** Use the private domain (e.g., `http://python-chat.railway.internal`)
     - Faster, no egress costs, more secure
     - Only accessible from other Railway services
   - **Alternative (public):** Use the public domain (e.g., `https://python-chat-staging.up.railway.app`)
     - Accessible from anywhere (useful for testing)
6. **In your Node service**, set environment variable:
   ```
   PYTHON_CHATKIT_URL=http://python-chat.railway.internal
   ```
   (Use the private `.railway.internal` domain for internal communication, or public domain if needed)

## Endpoint
- POST `/chatkit/message`
  - Request:
    ```json
    {
      "session_id": "sess_...",
      "text": "Hello",
      "staged_file_ids": ["file_123"],         // optional
      "vector_store_id": "vs_abc123"           // optional
    }
    ```
  - Response:
    ```json
    { "text": "assistant reply", "response_id": "resp_..." }
    ```


