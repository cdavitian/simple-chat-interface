from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from typing import Any, Dict, List, Optional
import os
import sys

app = FastAPI()

# Optional CORS for direct browser access; harmless if unused
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client with error handling
_openai_api_key = os.getenv("OPENAI_API_KEY")
if not _openai_api_key:
    print("[Python] ⚠️  WARNING: OPENAI_API_KEY not set - service may fail on requests", file=sys.stderr)
    client = None
else:
    try:
        client = OpenAI(api_key=_openai_api_key)
        print("[Python] ✅ OpenAI client initialized")
    except Exception as e:
        print(f"[Python] ❌ Failed to initialize OpenAI client: {e}", file=sys.stderr)
        client = None

# Optional PostgreSQL database connection (uses Railway variable names)
# Only initialized if DB_HOST is set - service works without it
_db_pool = None
try:
    db_host = os.getenv("DB_HOST")
    if db_host:
        import psycopg2
        from psycopg2 import pool
        
        db_config = {
            "host": db_host,
            "port": int(os.getenv("DB_PORT", "5432")),
            "database": os.getenv("DB_NAME", "railway"),
            "user": os.getenv("DB_USER", "postgres"),
            "password": os.getenv("DB_PASSWORD", ""),
        }
        
        # Handle SSL if required
        db_ssl = os.getenv("DB_SSL", "").lower()
        if db_ssl in ("1", "true", "require", "required"):
            db_config["sslmode"] = "require"
        
        _db_pool = psycopg2.pool.SimpleConnectionPool(1, 5, **db_config)
        print(f"[Python] ✅ Database connection pool initialized (host: {db_host})")
    else:
        print("[Python] ℹ️  No DB_HOST set - database access disabled (optional)")
except ImportError:
    print("[Python] ℹ️  psycopg2 not installed - database access disabled (optional)")
except Exception as e:
    print(f"[Python] ⚠️  Database connection failed (non-fatal): {e}")
    _db_pool = None


def get_db_connection():
    """Get a database connection from the pool (if available)."""
    if _db_pool is None:
        return None
    try:
        return _db_pool.getconn()
    except Exception as e:
        print(f"[Python] Database pool error: {e}")
        return None


def return_db_connection(conn):
    """Return a database connection to the pool."""
    if _db_pool and conn:
        try:
            _db_pool.putconn(conn)
        except Exception:
            pass


@app.on_event("startup")
async def startup_event():
    """Log startup information."""
    port = os.getenv("PORT", "8000")
    print(f"[Python] 🚀 FastAPI server starting on port {port}")
    print(f"[Python] 📋 Health check available at /health")
    if not client:
        print("[Python] ⚠️  OPENAI_API_KEY not configured - service will fail on chat requests")


@app.get("/health")
def health() -> Dict[str, Any]:
    """Health check endpoint for Railway."""
    db_status = "available" if _db_pool else "not_configured"
    openai_status = "configured" if client else "not_configured"
    return {
        "ok": True,
        "database": db_status,
        "openai": openai_status
    }


@app.post("/chatkit/message")
def send(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    if not client:
        raise HTTPException(status_code=500, detail="OpenAI client not initialized - check OPENAI_API_KEY")
    
    try:
        session_id: str = payload.get("session_id")
        text: str = payload.get("text", "")
        staged_file_ids: List[str] = payload.get("staged_file_ids", []) or []
        vector_store_id: Optional[str] = payload.get("vector_store_id")

        if not session_id or not text:
            raise HTTPException(status_code=400, detail="Missing required fields: session_id and text")

        tools: List[Dict[str, Any]] = [{"type": "file_search"}]
        tool_resources: Optional[Dict[str, Any]] = None
        if vector_store_id:
            tool_resources = {"file_search": {"vector_store_ids": [vector_store_id]}}

        input_message: Dict[str, Any] = {
            "role": "user",
            "content": text,
        }
        if staged_file_ids:
            input_message["attachments"] = [
                {"file_id": fid, "tools": [{"type": "file_search"}]} for fid in staged_file_ids
            ]

        # Build payload dictionary matching Node.js structure
        payload: Dict[str, Any] = {
            "session_id": session_id,
            "input": [input_message],
        }
        if tools:
            payload["tools"] = tools
        if tool_resources:
            payload["tool_resources"] = tool_resources

        # Try to access the responses API - the Python SDK structure may differ from Node.js
        try:
            # Try the expected path first: client.beta.chatkit.sessions.responses.create
            sessions_obj = client.beta.chatkit.sessions
            
            if hasattr(sessions_obj, 'responses'):
                # Standard path: sessions.responses.create
                resp = sessions_obj.responses.create(**payload)
            elif hasattr(sessions_obj, 'create_response'):
                # Alternative: sessions.create_response
                resp = sessions_obj.create_response(**payload)
            elif hasattr(client.beta.chatkit, 'sessions_responses'):
                # Alternative: client.beta.chatkit.sessions_responses.create
                resp = client.beta.chatkit.sessions_responses.create(**payload)
            else:
                # Log available attributes for debugging
                available_attrs = [attr for attr in dir(sessions_obj) if not attr.startswith('_')]
                chatkit_attrs = [attr for attr in dir(client.beta.chatkit) if not attr.startswith('_')]
                raise HTTPException(
                    status_code=500,
                    detail=f"ChatKit Sessions API structure mismatch. "
                           f"'sessions' object has no 'responses' attribute. "
                           f"Sessions attributes: {', '.join(available_attrs[:10])}. "
                           f"ChatKit attributes: {', '.join(chatkit_attrs[:10])}. "
                           f"Please check OpenAI Python SDK version compatibility. "
                           f"Expected: client.beta.chatkit.sessions.responses.create"
                )
        except AttributeError as e:
            raise HTTPException(
                status_code=500,
                detail=f"ChatKit API access error: {str(e)}. "
                       "Expected: client.beta.chatkit.sessions.responses.create"
            )

        # Some SDK versions expose to_dict; be defensive
        maybe_dict = None
        try:
            maybe_dict = resp.to_dict()  # type: ignore[attr-defined]
        except Exception:
            maybe_dict = None

        return {
            "text": getattr(resp, "output_text", "") or "",
            "response_id": getattr(resp, "id", None),
            "raw": maybe_dict,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Log the full error for debugging
        import traceback
        error_trace = traceback.format_exc()
        print(f"[Python] ❌ Error in /chatkit/message: {e}", file=sys.stderr)
        print(f"[Python] ❌ Traceback:\n{error_trace}", file=sys.stderr)
        # Ensure upstream returns JSON 500 instead of crashing the worker
        raise HTTPException(status_code=500, detail=str(e))


