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

        # --- minimal, robust call using Responses API with content parts ---
        print(f"[Python] OpenAI SDK version: {openai_version}")

        # Honor either NO_RETRIEVAL or legacy DEBUG_NO_RETRIEVAL for convenience
        NO_RETRIEVAL = (os.getenv("NO_RETRIEVAL") == "1") or (os.getenv("DEBUG_NO_RETRIEVAL") == "1")
        if not NO_RETRIEVAL:
            print("[Python] Retrieval features active (NO_RETRIEVAL != 1)")
        else:
            print("[Python] Retrieval disabled (NO_RETRIEVAL=1)")

        # Build content parts and attachments
        content_parts = [{"type": "input_text", "text": text}]

        # Reintroduce attachments in all modes:
        # - When retrieval is disabled (NO_RETRIEVAL), include only file_id (no tools/vector stores)
        # - When retrieval is enabled, include file_id with file_search tool to enable retrieval
        if staged_file_ids:
            if NO_RETRIEVAL:
                attachments = [{"file_id": fid} for fid in staged_file_ids]
            else:
                attachments = [
                    {"file_id": fid, "tools": [{"type": "file_search"}]}
                    for fid in staged_file_ids
                ]
        else:
            attachments = []

        use_file_search = (not NO_RETRIEVAL) and bool(vector_store_id or attachments)

        # Build input message; omit 'attachments' key when disabled/empty
        input_message = {"role": "user", "content": content_parts}
        # Always include attachments when present, even if retrieval is disabled
        if attachments:
            input_message["attachments"] = attachments

        # Ensure all metadata values are strings (OpenAI API requirement)
        retrieval_disabled_str = "1" if NO_RETRIEVAL else "0"
        
        base_args = dict(
            model=os.getenv("OPENAI_MODEL", "gpt-5"),
            input=[input_message],
            metadata={
                "route": "python.chat.message",
                "session_id": str(session_id),
                # Do not include vector_store_id when retrieval is disabled
                **({} if NO_RETRIEVAL else {"vector_store_id": str(vector_store_id or "")}),
                # OpenAI metadata values must be strings
                "retrieval_disabled": retrieval_disabled_str,
            },
        )

        if use_file_search:
            base_args["tools"] = [{"type": "file_search"}]

        # Try modern-style vector store binding; on 400 unknown_parameter, retry without it
        extra = {}
        if not NO_RETRIEVAL and vector_store_id:
            extra["tool_resources"] = {"file_search": {"vector_store_ids": [vector_store_id]}}

        # Log what we're about to send regarding retrieval
        try:
            sent_file_ids = [a.get("file_id") for a in attachments] if attachments else []
            print(f"[Python] Retrieval config -> disabled={NO_RETRIEVAL}, vector_store_id={'<none>' if not vector_store_id else vector_store_id}, file_ids={sent_file_ids}")
        except Exception:
            pass

        try:
            if extra:
                resp = client.responses.create(**base_args, extra_body=extra)
            else:
                resp = client.responses.create(**base_args)
        except Exception as e:
            if (not NO_RETRIEVAL) and ("Unknown parameter: 'tool_resources'" in str(e) or "unknown_parameter" in str(e)):
                print("[Python] ℹ️ API rejects tool_resources; retrying without VS binding")
                resp = client.responses.create(**base_args)
            else:
                raise

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

        # Extract any file/vector-store IDs from response for logging
        def _walk(obj):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    yield (k, v)
                    yield from _walk(v)
            elif isinstance(obj, list):
                for item in obj:
                    yield from _walk(item)

        resp_file_ids: List[str] = []
        resp_vector_store_ids: List[str] = []
        try:
            for k, v in _walk(maybe_dict or {}):
                if k in ("file_id",) and isinstance(v, str):
                    resp_file_ids.append(v)
                elif k in ("file_ids", "vector_store_ids") and isinstance(v, list):
                    for vv in v:
                        if isinstance(vv, str):
                            if k == "file_ids":
                                resp_file_ids.append(vv)
                            else:
                                resp_vector_store_ids.append(vv)
                elif k == "vector_store_id" and isinstance(v, str):
                    resp_vector_store_ids.append(v)
        except Exception:
            pass

        if resp_file_ids or resp_vector_store_ids:
            print(f"[Python] Response retrieval IDs -> file_ids={resp_file_ids}, vector_store_ids={resp_vector_store_ids}")
        else:
            print("[Python] Response contains no retrieval IDs (or none detected)")

        # Redact retrieval IDs from the outgoing payload when retrieval is disabled
        def _redact(obj):
            if obj is None:
                return None
            if isinstance(obj, dict):
                cleaned = {}
                for k, v in obj.items():
                    if k in ("file_id", "file_ids", "vector_store_id", "vector_store_ids", "tool_resources"):
                        # Drop these keys entirely when redacting
                        continue
                    cleaned[k] = _redact(v)
                return cleaned
            if isinstance(obj, list):
                return [_redact(x) for x in obj]
            return obj

        outgoing_raw = maybe_dict if not NO_RETRIEVAL else _redact(maybe_dict)

        return {
            "text": out_text or "",
            "response_id": getattr(resp, "id", None),
            "raw": outgoing_raw,
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


