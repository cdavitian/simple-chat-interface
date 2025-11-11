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
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
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
  
  // Using a custom input + send; do not pass unsupported composer options to ChatKit

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
  // Initialize ChatKit with only supported options
  const chatkit = useChatKit({
    api: {
      getClientSecret: getClientSecret
    },
    composer: {
      attachments: {
        enabled: true,
        // Accept a broad but safe set of types/extensions
        accept: {
          'application/pdf': ['.pdf'],
          'image/*': ['.png', '.jpg', '.jpeg'],
          'text/plain': ['.txt', '.md', '.csv'],
          'text/csv': ['.csv'],
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          'application/vnd.ms-excel': ['.xls'],
          'application/json': ['.json']
        },
        maxSize: 100 * 1024 * 1024, // 100MB
        maxCount: 10
      }
    }
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
      
      // No composer options are passed; using custom input instead
     
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
  }, [control]);
  
  // Using ChatKit's native composer

  // No fetch interception required when using native composer

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
    hasPublicKey: !!sessionData?.publicKey
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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <ChatKit 
        control={control}
        style={{ 
          flex: '1 1 0',
          width: '100%', 
          display: 'block',
          minHeight: '0',
          minWidth: '360px',
          overflow: 'hidden'
        }}
      />
      
      {/* Buttons below composer bar */}
      <div style={{ 
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        padding: '16px',
        backgroundColor: '#ffffff',
        borderTop: '1px solid rgba(148, 163, 184, 0.2)',
        zIndex: 100,
        minHeight: '60px',
        flexShrink: 0
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
          className="icon-button"
          style={{
            padding: '12px 18px',
            fontSize: '14px',
            fontWeight: '600'
          }}
          title="Attach a file"
        >
          📎
        </button>
        {uploadStatus && (
          <div style={{
            marginLeft: 'auto',
            padding: '10px 15px',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            border: '1px solid rgba(102, 126, 234, 0.2)',
            borderRadius: '12px',
            fontSize: '13px',
            maxWidth: '300px',
            wordBreak: 'break-word'
          }}>
            {uploadStatus}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;