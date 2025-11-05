import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { createFileStager } from './chatkitFiles';
import { buildMessageContent } from './utils/fileTypeDetector';
import { registerUploadedS3Object } from './api';
import MenuBar from './components/MenuBar';

// PROVE THIS FILE LOADED IN BROWSER
console.log("[BOOT] AppSDK.js loaded");

const fileStager = createFileStager();
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

// --- message shape helpers ---

function normalizeMessage(m) {
  if (!m) return null;

  const text =
    m.text ??
    (Array.isArray(m.content) && m.content.find(x => x?.type === "text")?.text) ??
    m.content?.[0]?.text ??
    (typeof m.content === "string" ? m.content : "") ??
    "";

  return {
    id: m.id ?? `msg-${(globalThis.crypto?.randomUUID?.() ?? Date.now())}`,
    role: m.role || "assistant",
    text,
    content: [{ type: "text", text }],     // mirror for any legacy paths in your UI
    createdAt: m.createdAt ?? new Date().toISOString(),
  };
}

// Merge by id, keep order = old first then new (replace on id collision)
function mergeMessages(prev, incoming) {
  const map = new Map(prev.map(x => [x.id, x]));
  for (const raw of incoming) {
    const nm = normalizeMessage(raw);
    if (!nm) continue;
    map.set(nm.id, { ...(map.get(nm.id) || {}), ...nm });
  }
  return Array.from(map.values());
}

export async function onCustomToolS3UploadSuccess({ key, filename, bucket }) {
  const { file_id, content_type, category } = await registerUploadedS3Object({ key, filename, bucket });
  fileStager.add(file_id, { content_type, filename, category });
  return file_id;
}

export function getStagedFileIds() {
  return fileStager.list();
}

function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/user');
        if (!response.ok) {
          window.location.href = '/login';
          return;
        }

        const userData = await response.json();
        setUser(userData);

        if (userData.userType === 'New') {
          window.location.href = '/new-user-home';
          return;
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        setError('Authentication failed');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading">
          <div className="loading-spinner" />
          <p>Loading assistant…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => (window.location.href = '/login')}>Go to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <MenuBar user={user} />

      <ChatInterface user={user} />
    </div>
  );
}

function ChatInterface({ user }) {
  const [messages, setMessages] = useState([]);

// PROVE THIS COMPONENT MOUNTED + create chatDebug

useEffect(() => {

  // 1) Big on-screen banner so you can't miss it

  const tag = "STAGING BUILD " + new Date().toISOString();

  const el = document.createElement("div");

  el.id = "build-banner";

  el.textContent = tag;

  el.style.cssText = "position:fixed;z-index:99999;top:0;left:0;padding:6px 10px;background:#222;color:#0f0;font:12px/1.2 monospace";

  document.body.appendChild(el);

  // 2) Console markers

  console.log("[MOUNT] ChatInterface render");

  console.log("[BUILD TAG]", tag);

  // 3) Minimal debug helper

  window.chatDebug = {

    push: (m) => {

      const msg = { id: 'dbg-' + Date.now(), role: m?.role || 'assistant', text: m?.text || String(m) || '(empty)' };

      setMessages(prev => [...prev, msg]);

    },

    clear: () => setMessages([]),

  };

  console.log("[chatDebug] ready");

  return () => el.remove();

}, []);

  // Optional: show count each render (helps confirm state updates)
  useEffect(() => {
    console.log("[messages] count =", messages.length);
  }, [messages]);
  
  const pushRef = useRef(null);
  const messagesRef = useRef([]);

  // keep a stable "append one message" function
  useEffect(() => {
    pushRef.current = (m) => {
      const n = normalizeMessage(m);
      if (!n) return;
      setMessages(prev => [...prev, n]);
    };
  }, []);

  // sync messages to ref for debug API access
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // expose a single, durable window.chatDebug exactly once
  useEffect(() => {
    // create only if missing, and keep a stable object reference
    if (!globalThis.chatDebug) {
      const api = {
        push(m) { pushRef.current?.(m); },
        clear: () => setMessages([]),
        len:   () => { console.log("len:", messagesRef.current.length); },
        log:   () => { console.log("messages:", messagesRef.current); },
      };
      globalThis.chatDebug = api;
      console.log("%c[chatDebug] ready", "color:#0a0");
    }
    // NOTE: we do not reassign window.chatDebug on subsequent renders
    // so it's always defined for console use.
    // We intentionally do NOT include `messages` in deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadingFileName, setUploadingFileName] = useState('');
  const [stagedFiles, setStagedFiles] = useState([]);
  const [initializing, setInitializing] = useState(true);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const resetUploads = useCallback(() => {
    fileStager.clear();
    setStagedFiles([]);
    setUploadingFileName('');
    setUploadStatus('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const loadConversation = useCallback(async () => {
    try {
      // Check if we're arriving from homepage via query parameter
      const urlParams = new URLSearchParams(window.location.search);
      const fromHomepage = urlParams.get('from') === 'homepage';
      
      // Build API URL with query parameter if coming from homepage
      const apiUrl = fromHomepage 
        ? '/api/sdk/conversation?from=homepage'
        : '/api/sdk/conversation';
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load conversation (${response.status})`);
      }

      const data = await response.json();
      // Clear messages if conversation is empty (new session)
      // This ensures the message window is cleared when starting fresh
      const conversation = Array.isArray(data.conversation) ? data.conversation : [];
      setMessages(conversation.map(normalizeMessage));
      
      // Log conversation ID if present (for new sessions)
      if (data.conversationId) {
        console.log('SDK conversation session:', data.conversationId);
      }
      
      // Remove query parameter from URL after processing
      if (fromHomepage) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (err) {
      console.error('Failed to load SDK conversation:', err);
      setSendError('Unable to load previous conversation. You can still start a new one.');
    } finally {
      setInitializing(false);
      scrollToBottom();
    }
  }, [scrollToBottom]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending, scrollToBottom]);

  // optional: fake event injector, once
  useEffect(() => {
    const handler = (e) => pushRef.current?.(e.detail || { role: "assistant", text: "👋 debug message" });
    window.addEventListener("fake-message", handler);
    return () => window.removeEventListener("fake-message", handler);
  }, []);

  const handleFileUpload = useCallback(
    async (file) => {
      if (!file) {
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadStatus(`✗ ${file.name} is larger than 20 MB`);
        return;
      }

      try {
        setUploadingFileName(file.name);
        setUploadStatus('Requesting upload URL…');

        const presignResp = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }),
        });

        if (!presignResp.ok) {
          const errorText = await presignResp.text();
          throw new Error(errorText || 'Failed to create upload URL');
        }

        const { uploadUrl, objectKey, contentType } = await presignResp.json();

        setUploadStatus('Uploading to S3…');

        // Use the exact Content-Type from presign response to match what S3 expects
        // Content-Length is automatically set by browser when using File object (no chunked encoding)
        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,  // File object ensures Content-Length is set automatically (no chunked)
          headers: { 
            'Content-Type': contentType || file.type || 'application/octet-stream',
            'x-amz-server-side-encryption': 'AES256'  // SSE-S3 encryption
          },
        });

        if (!uploadResp.ok) {
          throw new Error(`Upload failed (${uploadResp.status})`);
        }

        setUploadStatus('Registering and indexing file…');

        // The backend now waits for vector store indexing to complete before returning
        const fileId = await onCustomToolS3UploadSuccess({ key: objectKey, filename: file.name });
        setStagedFiles((prev) => [
          ...prev,
          { file_id: fileId, name: file.name, content_type: contentType || file.type || 'application/octet-stream' }
        ]);
        setUploadStatus(`✓ ${file.name} indexed and ready!`);
      } catch (err) {
        console.error('Upload error:', err);
        setUploadStatus(`✗ ${err.message || 'Upload failed'}`);
      } finally {
        setUploadingFileName('');
        setTimeout(() => setUploadStatus(''), 5000);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [],
  );

  const onFileSelect = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload],
  );

  const removeStagedFile = useCallback((fileId) => {
    const remainingFiles = fileStager
      .listWithMetadata()
      .filter((file) => file.file_id !== fileId);

    fileStager.clear();
    remainingFiles.forEach(({ file_id, ...metadata }) => fileStager.add(file_id, metadata));

    setStagedFiles((prev) => prev.filter((file) => file.file_id !== fileId));
  }, []);

  const handleSend = useCallback(async () => {
    if (isSending) return;

    const text = (inputValue || "").trim();
    const fileIds = fileStager.list();

    if (!text && fileIds.length === 0) return;

    // optimistic user bubble (normalized)
    const optimistic = normalizeMessage({
      id: `local-${Date.now()}`,
      role: "user",
      text,
    });

    setMessages(prev => mergeMessages(prev, [optimistic]));

    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch("/api/sdk/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          text,
          staged_file_ids: fileIds,
          staged_files: fileStager.listWithMetadata(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Assistant request failed (${response.status})`);
      }

      const data = await response.json();

      const assistantText = data?.message?.text ?? data?.text ?? "";
      const assistant = normalizeMessage({
        id: data?.message?.id ?? data?.responseId ?? `resp-${Date.now()}`,
        role: "assistant",
        text: assistantText,
        createdAt: data?.message?.createdAt,
      });

      setMessages(prev => mergeMessages(prev, [assistant]));
      setInputValue("");
      resetUploads();

    } catch (err) {
      console.error("Failed to send message:", err);
      setSendError(err.message || "Failed to send message");
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setIsSending(false);
    }
  }, [inputValue, isSending, resetUploads]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleNewChat = useCallback(async () => {
    if (isSending) {
      return;
    }

    try {
      const response = await fetch('/api/sdk/conversation/reset', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to reset conversation');
      }

      const data = await response.json();
      
      // Clear local state (message window should be empty)
      setMessages([]);
      setInputValue('');
      resetUploads();
      setSendError(null);
      setInitializing(false);
      
      // Log new session if conversationId is returned
      if (data.conversationId) {
        console.log('New SDK conversation session after reset:', data.conversationId);
      }
    } catch (err) {
      console.error('Failed to reset conversation:', err);
      setSendError('Failed to start new chat. Please try again.');
    }
  }, [isSending, resetUploads]);

  return (
    <div className="chat-sdk-container">
      <div className="chat-title">
        <h2>MCP Test - SDK</h2>
      </div>
      <div className="message-pane">
        {initializing ? (
          <div className="loading">
            <div className="loading-spinner" />
            <p>Loading conversation…</p>
          </div>
        ) : (
          <MessageList messages={messages} currentUser={user} />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer-panel">
        {sendError && <Banner type="error" message={sendError} onDismiss={() => setSendError(null)} />}

        {(uploadStatus || stagedFiles.length > 0) && (
          <div className="upload-panel">
            {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
            <StagedFileList files={stagedFiles} onRemove={removeStagedFile} />
          </div>
        )}

        <div className="composer-controls">
          <button
            className="icon-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!uploadingFileName || isSending}
            title="Attach a file"
          >
            📎
          </button>
          <textarea
            className="composer-input"
            placeholder="Ask the MCP assistant…"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isSending}
          />
          <button className="send-button" type="button" onClick={handleSend} disabled={isSending}>
            {isSending ? 'Sending…' : 'Send'}
          </button>
          <button
            className="new-chat-button"
            type="button"
            onClick={handleNewChat}
            disabled={isSending}
            title="Start a new chat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
              <line x1="20" y1="4" x2="4" y2="20"/>
            </svg>
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
    </div>
  );
}

function MessageList({ messages, currentUser }) {
  console.log("[MessageList] messages length =", messages?.length);

  if (!messages.length) {
    return (
      <div className="empty-state">
        <h3>Welcome{currentUser?.name ? `, ${currentUser.name}` : ''}!</h3>
        <p>Upload a document or start typing to begin your conversation.</p>
      </div>
    );
  }

  return (
    <ul className="message-list">
      {messages.map((message, index) => (
        <MessageBubble key={message.id || `${message.role}-${index}`} message={message} />
      ))}
    </ul>
  );
}

function MessageBubble({ message }) {
  const roleClass = getRoleClass(message.role);
  const timestamp = message.createdAt ? formatTimestamp(message.createdAt) : null;

  const displayItems = (() => {
    if (typeof message.text === "string" && message.text.length > 0) {
      return [{ type: "text", text: message.text }];
    }

    if (Array.isArray(message.content) && message.content.length > 0) {
      return message.content.map((it) => {
        if (!it) return it;
        if (it.type === "input_text" || it.type === "output_text")
          return { type: "text", text: it.text ?? "" };
        return it;
      });
    }

    return [{ type: "text", text: JSON.stringify(message, null, 2) }];
  })();

  return (
    <li className={`message-bubble ${roleClass}`}>
      <div className="message-meta">
        <span className="message-role">{formatRoleLabel(message.role)}</span>
        {timestamp && <time className="message-timestamp">{timestamp}</time>}
      </div>
      <div className="message-content">
        {displayItems.map((item, idx) => (
          <MessageContent key={idx} item={item} />
        ))}
      </div>
    </li>
  );
}

function MessageContent({ item }) {
  if (!item) {
    return null;
  }

  // Guard: if item has text but no type, render as text
  if (typeof item.text === "string" && (item.type === undefined || item.type === null)) {
    return <p className="message-text">{item.text}</p>;
  }

  switch (item.type) {
    case 'input_text':
    case 'output_text':
    case 'text':
      return <p className="message-text">{item.text}</p>;
    case 'input_file':
    case 'output_file':
      return (
        <div className="message-file">
          <span role="img" aria-label="attachment">
            📎
          </span>
          <span>{item.filename || item.file_id}</span>
        </div>
      );
    case 'tool_call':
    case 'tool_result':
    case 'tool_message':
      return <pre className="message-tool">{JSON.stringify(item, null, 2)}</pre>;
    default:
      return <pre className="message-raw">{JSON.stringify(item, null, 2)}</pre>;
  }
}

function StagedFileList({ files, onRemove }) {
  if (!files.length) {
    return null;
  }

  return (
    <div className="staged-files">
      {files.map((file) => (
        <div key={file.file_id} className="staged-file">
          <span>📎 {file.name || file.file_id}</span>
          <button type="button" onClick={() => onRemove(file.file_id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Banner({ type = 'info', message, onDismiss }) {
  if (!message) {
    return null;
  }

  return (
    <div className={`banner banner-${type}`}>
      <span>{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

function formatRoleLabel(role) {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return 'Tool';
    case 'system':
      return 'System';
    default:
      return role || 'Message';
  }
}

function getRoleClass(role) {
  switch (role) {
    case 'user':
      return 'from-user';
    case 'assistant':
      return 'from-assistant';
    case 'tool':
      return 'from-tool';
    default:
      return 'from-system';
  }
}

function formatTimestamp(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.warn('Failed to format timestamp:', value, err);
    return '';
  }
}

export { App };
export default ChatInterface;


