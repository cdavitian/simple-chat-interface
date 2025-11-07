# Python ChatKit Session Service

Minimal FastAPI service to call ChatKit Sessions API (preferred path for sessions).

## Requirements
- Python 3.9+
- `OPENAI_API_KEY` set in the environment

## Install
```bash
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run
```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

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


