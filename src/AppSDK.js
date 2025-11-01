import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { createFileStager } from './chatkitFiles';
import { registerUploadedS3Object } from './api';

const fileStager = createFileStager();
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export async function onCustomToolS3UploadSuccess({ key, filename, bucket }) {
  const { file_id } = await registerUploadedS3Object({ key, filename, bucket });
  fileStager.add(file_id);
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
      <div className="app-header">
        <h1>MCP SDK Assistant</h1>
        <div className="header-right">
          <div className="user-info">
            <img
              src={user?.picture || user?.avatar || '/default-avatar.png'}
              alt="User avatar"
              className="user-photo"
            />
            <span className="user-name">{user?.name || 'User'}</span>
            {user?.userType === 'Admin' && (
              <button className="admin-btn" onClick={() => (window.location.href = '/admin')}>
                Admin
              </button>
            )}
            <button className="logout-btn" onClick={() => (window.location.href = '/logout')}>
              Logout
            </button>
          </div>
          <div className="status-indicator">
            <span className="status-dot" />
            <span className="status-text">Online</span>
          </div>
        </div>
      </div>

      <ChatInterface user={user} />
    </div>
  );
}

function ChatInterface({ user }) {
  const [messages, setMessages] = useState([]);
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
      const response = await fetch('/api/sdk/conversation', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load conversation (${response.status})`);
      }

      const data = await response.json();
      setMessages(Array.isArray(data.conversation) ? data.conversation : []);
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

        const { uploadUrl, objectKey } = await presignResp.json();

        setUploadStatus('Uploading to S3…');

        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });

        if (!uploadResp.ok) {
          throw new Error(`Upload failed (${uploadResp.status})`);
        }

        setUploadStatus('Registering file with OpenAI…');

        const fileId = await onCustomToolS3UploadSuccess({ key: objectKey, filename: file.name });
        setStagedFiles((prev) => [...prev, { file_id: fileId, name: file.name }]);
        setUploadStatus(`✓ ${file.name} ready for the next message`);
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
    const remainingIds = fileStager.list().filter((id) => id !== fileId);
    fileStager.clear();
    remainingIds.forEach((id) => fileStager.add(id));
    setStagedFiles((prev) => prev.filter((file) => file.file_id !== fileId));
  }, []);

  const handleSend = useCallback(async () => {
    if (isSending) {
      return;
    }

    const text = inputValue.trim();
    const fileIds = fileStager.list();

    if (!text && fileIds.length === 0) {
      return;
    }

    const content = [];
    if (text) {
      content.push({ type: 'input_text', text });
    }
    fileIds.forEach((fid) => {
      content.push({ type: 'input_file', file_id: fid });
    });

    const optimisticId = `local-${Date.now()}`;
    const optimisticMessage = {
      id: optimisticId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      optimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch('/api/sdk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, staged_file_ids: fileIds }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Assistant request failed (${response.status})`);
      }

      const data = await response.json();
      setMessages(Array.isArray(data.conversation) ? data.conversation : []);
      setInputValue('');
      resetUploads();
    } catch (err) {
      console.error('Failed to send message:', err);
      setSendError(err.message || 'Failed to send message');
      setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
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

  return (
    <div className="chat-sdk-container">
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

  return (
    <li className={`message-bubble ${roleClass}`}>
      <div className="message-meta">
        <span className="message-role">{formatRoleLabel(message.role)}</span>
        {timestamp && <time className="message-timestamp">{timestamp}</time>}
      </div>
      <div className="message-content">
        {Array.isArray(message.content) && message.content.length > 0 ? (
          message.content.map((item, idx) => <MessageContent key={idx} item={item} />)
        ) : (
          <MessageContent item={{ type: 'text', text: JSON.stringify(message, null, 2) }} />
        )}
      </div>
    </li>
  );
}

function MessageContent({ item }) {
  if (!item) {
    return null;
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

export default App;


