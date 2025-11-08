from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from typing import Any, Dict, List, Optional
import os
import sys

# Get OpenAI version for logging
try:
    from openai import __version__ as openai_version
except (ImportError, AttributeError):
    try:
        import importlib.metadata
        openai_version = importlib.metadata.version("openai")
    except Exception:
        openai_version = "unknown"

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

        # --- minimal, robust call using Responses API with content parts ---
        print(f"[Python] OpenAI SDK version: {openai_version}")

        r_tools = [{"type": "file_search"}]
        r_tool_resources = {"file_search": {"vector_store_ids": [vector_store_id]}} if vector_store_id else None

        # Build content parts (input_text + optional file_search attachments)
        content_parts = [{"type": "input_text", "text": text}]
        # attachments belong on the message object, not inside content_parts
        attachments = [
            {"file_id": fid, "tools": [{"type": "file_search"}]}
            for fid in staged_file_ids
        ] if staged_file_ids else []

        resp = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5"),
            tools=r_tools,
            tool_resources=r_tool_resources,
            input=[{
                "role": "user",
                "content": content_parts,
                "attachments": attachments
            }],
            metadata={
                "route": "python.chat.message",
                "note": "chatkit bypass (SDK 2.7.1 lacks chatkit.responses/threads.create)",
                "session_id": session_id,
                "vector_store_id": vector_store_id or ""
            },
        )

        # Extract text defensively
        out_text = getattr(resp, "output_text", None)
        if not out_text:
            try:
                first = (resp.output or [])[0]
                for p in getattr(first, "content", []) or []:
                    if getattr(p, "type", None) in ("output_text", "text"):
                        out_text = getattr(p, "text", None)
                        if out_text:
                            break
            except Exception:
                out_text = None

        maybe_dict = None
        try:
            maybe_dict = resp.to_dict()
        except Exception:
            pass

        return {
            "text": out_text or "",
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


