import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import { createFileStager } from './chatkitFiles';
import { registerUploadedS3Object } from './api';
import MenuBar from './components/MenuBar';
import './App.css';

// Create file stager instance (shared across component re-renders)
const fileStager = createFileStager();

/**
 * Call this from your custom tool AFTER its presigned PUT to S3 succeeds.
 */
export async function onCustomToolS3UploadSuccess({ key, filename, bucket }) {
  const { file_id, content_type, category } = await registerUploadedS3Object({ key, filename, bucket });
  fileStager.add(file_id, { content_type, filename, category }); // quietly stage it with metadata
  return file_id;
}

/**
 * Optional: for debugging/inspecting staged file_ids
 */
export function getStagedFileIds() {
  return fileStager.list();
}

// Helper function to fetch a fresh ChatKit session
// Always fetches from server with no caching to ensure fresh tokens
async function fetchChatKitSession() {
  const response = await fetch('/api/chatkit/session', {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Accept': 'application/json',
    },
    credentials: 'include' // Ensure cookies are sent
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Session error: ${response.status} - ${errorText}`);
  }
  
  const sessionData = await response.json();
  return sessionData; // { clientToken, publicKey }
}

// Optional: Check token expiry (decodes ek_... token to check expires_at)
function getExpiryFromEk(token) {
  if (!token || !token.startsWith('ek_')) return undefined;
  
  try {
    const parts = token.split('_');
    const b64 = parts[parts.length - 1].replace(/[^A-Za-z0-9+/=]/g, '');
    const json = JSON.parse(atob(b64));
    return json.expires_at || json.expiresAt;
  } catch {
    return undefined;
  }
}

// Helper function to wrap operations with 401 retry logic
async function withTokenRefresh(getTokenFn, operationFn, retries = 1) {
  try {
    return await operationFn(await getTokenFn());
  } catch (error) {
    // Detect 401 or unauthorized errors
    const isUnauthorized = 
      error?.status === 401 || 
      error?.statusCode === 401 ||
      /unauthorized/i.test(String(error)) ||
      /401/i.test(String(error));
    
    if (isUnauthorized && retries > 0) {
      console.log('[ChatKit] 🔄 401 detected, refreshing token and retrying...');
      // Refresh token and retry once
      return await operationFn(await getTokenFn());
    }
    
    throw error;
  }
}

function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [chatkitInitialized, setChatkitInitialized] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const chatkitRef = useRef(null);




  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/user');
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          
          // Check user type and redirect if necessary
          if (userData.userType === 'New') {
            window.location.href = '/new-user-home';
            return;
          }
        } else {
          // Redirect to login if not authenticated
          window.location.href = '/login';
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

  useEffect(() => {
    // Initialize ChatKit after user is loaded
    if (user && !chatkitInitialized) {
      initializeChatKit();
    }
  }, [user, chatkitInitialized]);

  const initializeChatKit = async () => {
    try {
      console.log('Initializing ChatKit...');
      console.log('User authenticated:', !!user);
      console.log('User data:', user);
      
      // Always fetch fresh session data from server (no caching)
      console.log('Fetching fresh ChatKit session...');
      const sessionData = await fetchChatKitSession();
      
      console.log('ChatKit session data received:', {
        hasClientToken: !!sessionData?.clientToken,
        clientTokenPrefix: sessionData?.clientToken?.substring(0, 30) || 'N/A',
        hasPublicKey: !!sessionData?.publicKey,
        publicKeyPrefix: sessionData?.publicKey?.substring(0, 30) || 'N/A'
      });
      
      // Optional: Check token expiry
      if (sessionData?.clientToken) {
        const expiry = getExpiryFromEk(sessionData.clientToken);
        if (expiry) {
          const expiryDate = new Date(expiry * 1000);
          const now = new Date();
          console.log('[ChatKit] Token expiry:', {
            expiresAt: expiryDate.toISOString(),
            isExpired: expiryDate < now,
            timeUntilExpiry: expiryDate > now ? `${Math.round((expiryDate - now) / 1000)}s` : 'EXPIRED'
          });
        }
      }
      
      // Store session data in memory (not localStorage) and mark as initialized
      setSessionData(sessionData);
      setChatkitInitialized(true);
      console.log('Chat interface initialized');
      
    } catch (error) {
      console.error('ChatKit session initialization failed:', error);
      setError('Failed to initialize chat interface');
    }
  };


  if (loading) {
    return (
      <div className="app-container">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading ChatKit...</p>
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
          <button onClick={() => window.location.href = '/login'}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <MenuBar user={user} />
      
      <div className="chatkit-container" style={{ 
        width: '100%', 
        height: '600px', 
        minHeight: '600px',
        display: 'block',
        position: 'relative'
      }}>
        {!chatkitInitialized ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Initializing chat interface...</p>
          </div>
        ) : (
          <ChatKitComponent 
            sessionData={sessionData} 
            onSessionUpdate={(freshSession) => setSessionData(freshSession)}
            user={user}
          />
        )}
      </div>
    </div>
  );
}

function ChatKitComponent({ sessionData, onSessionUpdate, user }) {
  console.log('[ChatKit] ========================================');
  console.log('[ChatKit] Component rendering with sessionData:', sessionData);
  console.log('[ChatKit] SessionData details:', {
    hasClientToken: !!sessionData?.clientToken,
    clientTokenLength: sessionData?.clientToken?.length || 0,
    clientTokenPrefix: sessionData?.clientToken?.substring(0, 30) || 'N/A',
    hasPublicKey: !!sessionData?.publicKey,
    publicKeyPrefix: sessionData?.publicKey?.substring(0, 30) || 'N/A',
    sessionDataKeys: sessionData ? Object.keys(sessionData) : []
  });
  
  const [uploadingFile, setUploadingFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadedFileId, setUploadedFileId] = useState(null);
  const fileInputRef = useRef(null);
  const [promptText, setPromptText] = useState('');
  
  // S3 upload handler following the guidance pattern
  const handleFileUpload = useCallback(async (file) => {
    try {
      setUploadingFile(file.name);
      setUploadStatus('Getting upload URL...');
      
      // 1) Get presigned PUT URL from server
      const presignResp = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          filename: file.name, 
          mime: file.type,
          size: file.size
        })
      });

      if (!presignResp.ok) {
        const errorText = await presignResp.text();
        throw new Error(`Failed to presign upload: ${presignResp.status} ${errorText}`);
      }

      const { uploadUrl, objectKey, contentType } = await presignResp.json();
      
      setUploadStatus('Uploading to S3...');

      // 2) Upload file directly to S3
      // Use the exact Content-Type from presign response to match what S3 expects
      // Content-Length is automatically set by browser when using File object (no chunked encoding)
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        body: file,  // File object ensures Content-Length is set automatically (no chunked)
        headers: { 
          "Content-Type": contentType || file.type || 'application/octet-stream',
          "x-amz-server-side-encryption": "AES256"  // SSE-S3 encryption
        }
      });

      if (!uploadResp.ok) {
        throw new Error(`Failed to upload to S3: ${uploadResp.status}`);
      }
      
      setUploadStatus('Importing and indexing file...');

      // 3) Quiet ingest: register uploaded S3 object, add to vector store, and wait for indexing
      // The backend now waits for vector store indexing to complete before returning
      await onCustomToolS3UploadSuccess({
        key: objectKey,
        filename: file.name
      });
      
      setUploadStatus(`✓ ${file.name} ready! The file is indexed and searchable.`);
      console.log('[ChatKit] File uploaded successfully and staged for quiet ingest:', { 
        filename: file.name, 
        objectKey,
        stagedCount: fileStager.list().length
      });
      
      setTimeout(() => {
        setUploadingFile(null);
        setUploadStatus('');
        setUploadedFileId(null);
      }, 5000);
      
    } catch (error) {
      console.error('[ChatKit] Upload error:', error);
      setUploadStatus(`✗ Error: ${error.message}`);
      setTimeout(() => {
        setUploadingFile(null);
        setUploadStatus('');
      }, 5000);
    }
  }, [sessionData]);
  
  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFileUpload]);
  
  // Disable ChatKit's built-in composer; use our own input + send
  const composerConfig = useMemo(() => ({ enabled: false }), []);
  
  console.log('[ChatKit] Composer configuration:', JSON.stringify(composerConfig, null, 2));
  
  // Log before useChatKit is called
  console.log('[ChatKit] 🔐 About to initialize useChatKit hook...');
  console.log('[ChatKit] 🔐 SessionData available for hook:', !!sessionData);
  
  // Create the getClientSecret function that will be used by ChatKit
  // This function is called whenever ChatKit needs a token - we always fetch fresh
  const getClientSecret = useMemo(() => async (currentClientSecret) => {
    console.log('[ChatKit] ========================================');
    console.log('[ChatKit] 🔐🔐🔐 getClientSecret CALLED! 🔐🔐🔐');
    console.log('[ChatKit] 🔐 Called with currentClientSecret:', currentClientSecret?.substring(0, 30) + '...');
    
    // ALWAYS fetch fresh token from server - don't reuse sessionData
    // This ensures we never use stale/expired tokens
    try {
      console.log('[ChatKit] 🔐 Fetching fresh token from server...');
      const freshSession = await fetchChatKitSession();
      
      if (!freshSession?.clientToken) {
        console.error('[ChatKit] ❌ ERROR: No clientToken in fresh session!');
        throw new Error('No clientToken available from server');
      }
      
      // Optional: Check if token is expired before returning
      const expiry = getExpiryFromEk(freshSession.clientToken);
      if (expiry) {
        const expiryDate = new Date(expiry * 1000);
        const now = new Date();
        if (expiryDate < now) {
          console.warn('[ChatKit] ⚠️ WARNING: Fresh token is already expired!');
        } else {
          console.log('[ChatKit] ✅ Token is valid until:', expiryDate.toISOString());
        }
      }
      
      // Update sessionData in parent component if callback provided
      if (onSessionUpdate) {
        onSessionUpdate(freshSession);
      }
      
      console.log('[ChatKit] ✅ Returning fresh clientToken:', {
        length: freshSession.clientToken.length,
        prefix: freshSession.clientToken.substring(0, 30),
        suffix: freshSession.clientToken.substring(freshSession.clientToken.length - 10)
      });
      console.log('[ChatKit] ========================================');
      
      return freshSession.clientToken;
    } catch (error) {
      console.error('[ChatKit] ❌ Failed to fetch fresh token:', error);
      throw error;
    }
  }, [onSessionUpdate]);

  // getClientSecret: Always fetch a fresh token from server (never reuse stale tokens)
  // Pass composer via options so it is applied through setOptions
  // Get the send method directly from useChatKit
  const chatkit = useChatKit({
    api: {
      getClientSecret: getClientSecret
    },
    composer: composerConfig
  });
  
  const { control, sendUserMessage } = chatkit;

  console.log('[ChatKit] 🔐 useChatKit hook returned:', chatkit);
  console.log('[ChatKit] 🔐 useChatKit hook returned control:', control);
  console.log('[ChatKit] 🔐 Control methods available:', control ? Object.keys(control) : 'control is null/undefined');
  console.log('[ChatKit] 🔐 ChatKit methods available:', Object.keys(chatkit).filter(k => k !== 'control' && k !== 'ref'));
  console.log('[ChatKit] 🔐 sendUserMessage method:', typeof sendUserMessage === 'function' ? 'available' : 'not available');
  
  // Log when control is first available and set up event handlers
  useEffect(() => {
    if (control) {
      console.log('[ChatKit] ✅ Control object is now available');
      console.log('[ChatKit] Control details:', {
        hasSetInstance: typeof control.setInstance === 'function',
        hasOptions: !!control.options,
        hasHandlers: !!control.handlers,
        optionsKeys: control.options ? Object.keys(control.options) : [],
        handlersKeys: control.handlers ? Object.keys(control.handlers) : []
      });
      
      // Try to update composer options via control API if available
      if (typeof control.setOptions === 'function') {
        console.log('[ChatKit] 🔧 Setting composer options via control API');
        try {
          control.setOptions({
            composer: composerConfig
          });
        } catch (err) {
          console.warn('[ChatKit] ⚠️ Failed to set composer options via control API:', err);
        }
      }
      
      // Set up event handlers to intercept message sends
      if (control.handlers) {
        const originalOnThreadChange = control.handlers.onThreadChange;
        control.handlers.onThreadChange = (...args) => {
          console.log('[ChatKit] 📨 onThreadChange event:', args);
          if (originalOnThreadChange) {
            originalOnThreadChange(...args);
          }
        };
        
        // Note: ChatKit might not have a direct "onMessageSend" handler
        // We'll need to rely on fetch interception or use sendUserMessage directly
      }
    } else {
      console.warn('[ChatKit] ⚠️ Control object is not available yet');
    }
  }, [control, composerConfig]);
  
  // Built-in composer is disabled; no DOM hiding needed

  // Custom send: use our own input and POST to server, then refresh ChatKit
  const handleSend = useCallback(async () => {
    try {
      if (!sessionData?.sessionId) {
        console.error('[ChatKit] ❌ Cannot send: no sessionId');
        return;
      }

      const text = (promptText || '').trim();
      const stagedIds = fileStager.list();
      if (!text && stagedIds.length === 0) {
        return;
      }

      const payload = {
        session_id: sessionData.sessionId,
        text: text || undefined,
        staged_file_ids: stagedIds,
        staged_files: fileStager.listWithMetadata(),
      };

      const resp = await fetch('/api/chatkit/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Failed to send: ${resp.status} ${t}`);
      }
      await resp.json();

      setPromptText('');
      fileStager.clear();
      if (control?.fetchUpdates) {
        control.fetchUpdates();
      }
    } catch (err) {
      console.error('[ChatKit] ❌ handleSend failed:', err);
    }
  }, [promptText, sessionData?.sessionId, control]);

  // No fetch interception required when composer is disabled and we control send

  // No iframe/composer interception needed

  // Log when component re-renders
  useEffect(() => {
    console.log('[ChatKit] Component mounted/updated');
    return () => {
      console.log('[ChatKit] Component unmounting');
    };
  });

  // No longer need to set composer via setInstance; it's provided in options above

  // Force getClientSecret to be called if ChatKit needs a token but hasn't called it
  // This ensures tokens are available even if ChatKit doesn't auto-call getClientSecret
  useEffect(() => {
    if (!sessionData?.clientToken && getClientSecret) {
      console.log('[ChatKit] 🔄 No initial token, calling getClientSecret proactively...');
      getClientSecret(null).then(token => {
        console.log('[ChatKit] ✅ Proactive getClientSecret returned token:', token?.substring(0, 30) + '...');
        if (onSessionUpdate) {
          onSessionUpdate({ clientToken: token, publicKey: sessionData?.publicKey });
        }
      }).catch(err => {
        console.error('[ChatKit] ❌ Proactive getClientSecret failed:', err);
      });
    }
  }, [sessionData, getClientSecret, onSessionUpdate]);

  console.log('[ChatKit] Rendering ChatKit component with props:', {
    hasControl: !!control,
    hasClientToken: !!sessionData?.clientToken,
    hasPublicKey: !!sessionData?.publicKey,
    composerConfig: composerConfig
  });

  // Only render ChatKit when we have the required data
  if (!sessionData?.publicKey) {
    return (
      <div style={{ width: '100%', height: '600px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading ChatKit configuration...</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '600px', display: 'block', position: 'relative' }}>
      {/* Custom file upload UI */}
      <div style={{ 
        position: 'absolute', 
        top: '10px', 
        right: '10px', 
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        alignItems: 'flex-end'
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx"
          onChange={onFileSelect}
          style={{ display: 'none' }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!!uploadingFile}
          style={{
            padding: '10px 20px',
            backgroundColor: uploadingFile ? '#ccc' : '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: uploadingFile ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          {uploadingFile ? '📤 Uploading...' : '📎 Upload File'}
        </button>
        {uploadStatus && (
          <div style={{
            padding: '10px 15px',
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '5px',
            fontSize: '12px',
            maxWidth: '300px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            wordBreak: 'break-word'
          }}>
            {uploadStatus}
          </div>
        )}
      </div>
      
      {/* Custom input + send */}
      <div style={{
        position: 'absolute',
        left: '10px',
        right: '10px',
        bottom: '10px',
        zIndex: 1000,
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
      }}>
        <input
          type="text"
          placeholder="Type your message"
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          style={{
            flex: 1,
            padding: '10px 12px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '14px'
          }}
        />
        <button
          onClick={handleSend}
          disabled={!promptText && fileStager.list().length === 0}
          style={{
            padding: '10px 16px',
            backgroundColor: (!promptText && fileStager.list().length === 0) ? '#ccc' : '#0a66c2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: (!promptText && fileStager.list().length === 0) ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 600
          }}
        >
          Send
        </button>
      </div>

      <ChatKit 
        control={control}
        style={{ 
          height: '600px', 
          width: '100%', 
          display: 'block',
          minHeight: '600px',
          minWidth: '360px'
        }}
      />
    </div>
  );
}

export default App;