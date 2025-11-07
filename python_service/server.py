from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from typing import Any, Dict, List, Optional
import os

app = FastAPI()

# Optional CORS for direct browser access; harmless if unused
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


@app.post("/chatkit/message")
def send(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    session_id: str = payload.get("session_id")
    text: str = payload.get("text", "")
    staged_file_ids: List[str] = payload.get("staged_file_ids", []) or []
    vector_store_id: Optional[str] = payload.get("vector_store_id")

    if not session_id or not text:
        return {"error": "Missing required fields: session_id and text"}

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

    resp = client.beta.chatkit.sessions.responses.create(
        session_id=session_id,
        tools=tools,
        tool_resources=tool_resources,
        input=[input_message],
    )

    return {
        "text": getattr(resp, "output_text", "") or "",
        "response_id": getattr(resp, "id", None),
    }


