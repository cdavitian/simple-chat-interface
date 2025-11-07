import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { createFileStager } from './chatkitFiles';
import { buildMessageContent } from './utils/fileTypeDetector';
import { registerUploadedS3Object } from './api';
import MenuBar from './components/MenuBar';

const fileStager = createFileStager();
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

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

        setUploadStatus('Registering file with OpenAI…');

        const fileId = await onCustomToolS3UploadSuccess({ key: objectKey, filename: file.name });
        setStagedFiles((prev) => [
          ...prev,
          { file_id: fileId, name: file.name, content_type: contentType || file.type || 'application/octet-stream' }
        ]);
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
    const remainingFiles = fileStager
      .listWithMetadata()
      .filter((file) => file.file_id !== fileId);

    fileStager.clear();
    remainingFiles.forEach(({ file_id, ...metadata }) => fileStager.add(file_id, metadata));

    setStagedFiles((prev) => prev.filter((file) => file.file_id !== fileId));
  }, []);

  const handleSend = useCallback(async () => {
    console.log('[SDK] 🚀🚀🚀 handleSend CALLED 🚀🚀🚀', { isSending, inputValue: inputValue.substring(0, 50) });
    if (isSending) {
      console.log('[SDK] ⏸️ Already sending, returning early');
      return;
    }

    const text = inputValue.trim();
    const fileIds = fileStager.list();
    console.log('[SDK] 📝 Message details:', { textLength: text.length, fileIdsCount: fileIds.length });

    if (!text && fileIds.length === 0) {
      console.log('[SDK] ⚠️ No content to send (no text and no files) - RETURNING EARLY');
      return;
    }

    const content = [];
    if (text) {
      content.push({ type: 'input_text', text });
    }
    fileStager.listWithMetadata().forEach(({ file_id, ...metadata }) => {
      const messageContent = buildMessageContent(file_id, metadata);
      content.push({
        type: messageContent.type,
        file_id: messageContent.file_id,
        display_name: messageContent.display_name,
      });
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
      const debugFileIds = fileIds;
      const debugFilesMeta = fileStager.listWithMetadata();
      console.log('[SDK][DEBUG] staged_file_ids:', debugFileIds);
      console.log('[SDK][DEBUG] staged_files:', debugFilesMeta);

      const debugQuery = debugFileIds.length ? `?file_ids=${encodeURIComponent(debugFileIds.join(','))}` : '';
      const url = `/api/sdk/message${debugQuery}`;
      const payload = {
        text,
        staged_file_ids: fileIds,
        staged_files: debugFilesMeta
      };
      console.log('[SDK][NETWORK] About to POST:', { url, method: 'POST', payload });
      console.log('[SDK][NETWORK] ⚡⚡⚡ FETCH CALL STARTING ⚡⚡⚡');
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-File-Ids': debugFileIds.join(','),
            'X-Debug-File-Count': String(debugFileIds.length)
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        console.log('[SDK][NETWORK] ✅ POST request completed, response status:', response.status);
      } catch (fetchError) {
        console.error('[SDK][NETWORK] ❌ FETCH ERROR:', fetchError);
        throw fetchError;
      }

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

  const handleReset = useCallback(async () => {
    if (isSending) {
      return;
    }

    try {
      setIsSending(true);
      setSendError(null);

      // Call the reset endpoint
      const response = await fetch('/api/sdk/conversation/reset', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Failed to reset conversation (${response.status})`);
      }

      const data = await response.json();
      
      // Clear messages immediately
      setMessages([]);
      
      // Clear input and staged files
      setInputValue('');
      resetUploads();
      
      // Reload the conversation (which should be empty now)
      await loadConversation();
    } catch (err) {
      console.error('Failed to reset conversation:', err);
      setSendError(err.message || 'Failed to reset conversation');
    } finally {
      setIsSending(false);
    }
  }, [isSending, resetUploads, loadConversation]);

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
          <button className="send-button send-button-compact" type="button" onClick={handleSend} disabled={isSending}>
            {isSending ? 'Sending…' : 'Send'}
          </button>
          <button 
            className="reset-button" 
            type="button" 
            onClick={handleReset} 
            disabled={isSending}
            title="Start new conversation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
              <path d="M8 14L14 8M14 8L11 8M14 8L14 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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


