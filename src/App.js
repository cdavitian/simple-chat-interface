import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import './App.css';

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
      <div className="app-header">
        <h1>ChatKit AI Assistant</h1>
        <div className="header-right">
          <div className="user-info">
            <img 
              src={user?.picture || user?.avatar || '/default-avatar.png'} 
              alt="User" 
              className="user-photo"
            />
            <span className="user-name">{user?.name || 'User'}</span>
            {user?.userType === 'Admin' && (
              <button 
                className="admin-btn"
                onClick={() => window.location.href = '/admin'}
              >
                Admin
              </button>
            )}
            <button 
              className="logout-btn"
              onClick={() => window.location.href = '/logout'}
            >
              Logout
            </button>
          </div>
          <div className="status-indicator">
            <span className="status-dot"></span>
            <span className="status-text">Online</span>
          </div>
        </div>
      </div>
      
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
  const chatkitInstanceRef = useRef(null);
  
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

      const { uploadUrl, objectKey } = await presignResp.json();
      
      setUploadStatus('Uploading to S3...');

      // 2) Upload file directly to S3
      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type }
      });

      if (!uploadResp.ok) {
        throw new Error(`Failed to upload to S3: ${uploadResp.status}`);
      }
      
      setUploadStatus('Importing to OpenAI...');

      // 3) Import from S3 to OpenAI Files API
      const importResp = await fetch("/api/openai/import-s3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          objectKey, 
          filename: file.name, 
          purpose: "assistants" 
        })
      });

      if (!importResp.ok) {
        const errorText = await importResp.text();
        throw new Error(`Failed to import from S3: ${importResp.status} ${errorText}`);
      }

      const { file_id } = await importResp.json();
      
      setUploadedFileId(file_id);
      setUploadStatus(`✓ ${file.name} uploaded! Sending to ChatKit...`);
      console.log('[ChatKit] File uploaded successfully:', { filename: file.name, file_id, objectKey });
      
      // Send message with file_id to ChatKit
      try {
        if (chatkitInstanceRef.current) {
          // Use ChatKit's send method to send a message with the file attachment
          await chatkitInstanceRef.current.send({
            content: [
              { type: "input_text", text: `I've uploaded ${file.name}. Please analyze this file.` },
              { type: "input_file", file_id: file_id }
            ]
          });
          
          setUploadStatus(`✓ File sent to ChatKit successfully!`);
          console.log('[ChatKit] Message sent with file_id:', file_id);
        } else {
          console.warn('[ChatKit] ChatKit instance not available, file uploaded but message not sent');
          setUploadStatus(`✓ ${file.name} uploaded! (File ID: ${file_id})\nPlease manually mention the file in your message.`);
        }
      } catch (sendError) {
        console.error('[ChatKit] Failed to send message with file:', sendError);
        setUploadStatus(`✓ File uploaded but failed to send message.\nFile ID: ${file_id}\nPlease manually mention the file.`);
      }
      
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
  }, []);
  
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
  
  // Composer configuration - keep file_upload enabled for session but handle uploads manually
  const composerConfig = useMemo(() => ({
    attachments: {
      enabled: false, // Disable to prevent built-in upload mechanism
      maxSize: 20 * 1024 * 1024, // 20MB per file
      maxCount: 3,
      accept: {
        "application/pdf": [".pdf"],
        "image/*": [".png", ".jpg"],
        "text/csv": [".csv"],
        "application/csv": [".csv"],
        "text/plain": [".csv"],
        "application/vnd.ms-excel": [".xls", ".csv"],
        "application/octet-stream": [".csv", ".xls", ".xlsx"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
      },
    },
  }), []);
  
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
  const { control } = useChatKit({
    api: {
      getClientSecret: getClientSecret
    },
    composer: composerConfig
  });

  console.log('[ChatKit] 🔐 useChatKit hook returned control:', control);
  console.log('[ChatKit] 🔐 Control methods available:', control ? Object.keys(control) : 'control is null/undefined');
  
  // Log when control is first available and capture ChatKit instance
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
      
      // Store reference to ChatKit instance when setInstance is called
      const originalSetInstance = control.setInstance;
      if (typeof originalSetInstance === 'function') {
        control.setInstance = (instance) => {
          console.log('[ChatKit] ChatKit instance set:', instance);
          chatkitInstanceRef.current = instance;
          return originalSetInstance(instance);
        };
      }
    } else {
      console.warn('[ChatKit] ⚠️ Control object is not available yet');
    }
  }, [control]);

  // Debug: Check element after render and inspect ChatKit state
  useEffect(() => {
    console.log('[ChatKit] 🔍 useEffect triggered, checking ChatKit element...');
    console.log('[ChatKit] 🔍 SessionData in effect:', !!sessionData);
    
    const checkElement = () => {
      const el = document.querySelector('openai-chatkit');
      console.log('[ChatKit] Element search result:', el ? 'Found' : 'Not found');
      
      if (el) {
        const rect = el.getBoundingClientRect();
        console.log('[ChatKit] Element bounds:', {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          visible: rect.width > 0 && rect.height > 0
        });
        
        console.log('[ChatKit] Element attributes:', Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`));
        
        // Check shadow DOM
        const shadowRoot = el.shadowRoot;
        console.log('[ChatKit] Shadow DOM:', shadowRoot ? 'Present' : 'Missing');
        
        if (shadowRoot) {
          // Look for composer elements in shadow DOM
          const composer = shadowRoot.querySelector('[data-testid*="composer"], [class*="composer"], textarea, input[type="text"]');
          console.log('[ChatKit] Composer element in shadow DOM:', composer ? 'Found' : 'Not found');
          
          if (composer) {
            console.log('[ChatKit] Composer element:', {
              tagName: composer.tagName,
              className: composer.className,
              attributes: Array.from(composer.attributes).map(attr => `${attr.name}="${attr.value}"`)
            });
          }
          
          // Look for attachment/paperclip button
          const attachmentButton = shadowRoot.querySelector('[data-testid*="attach"], [data-testid*="attachment"], [aria-label*="attach"], [class*="attach"], [class*="paperclip"], button[title*="attach"]');
          console.log('[ChatKit] Attachment button in shadow DOM:', attachmentButton ? 'Found' : 'Not found');
          
          if (attachmentButton) {
            console.log('[ChatKit] Attachment button element:', {
              tagName: attachmentButton.tagName,
              className: attachmentButton.className,
              ariaLabel: attachmentButton.getAttribute('aria-label'),
              title: attachmentButton.getAttribute('title'),
              hidden: attachmentButton.hasAttribute('hidden'),
              style: attachmentButton.style.display,
              computedStyle: getComputedStyle(attachmentButton).display
            });
          } else {
            // Log all buttons in the composer area to see what's available
            const allButtons = shadowRoot.querySelectorAll('button');
            console.log('[ChatKit] All buttons in shadow DOM:', allButtons.length);
            allButtons.forEach((btn, idx) => {
              console.log(`[ChatKit] Button ${idx}:`, {
                text: btn.textContent?.trim(),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                className: btn.className,
                hidden: btn.hasAttribute('hidden'),
                display: getComputedStyle(btn).display
              });
            });
          }
          
          // Log all elements with common attachment-related classes/attributes
          const attachmentElements = shadowRoot.querySelectorAll('[class*="attach"], [data-testid*="attach"], [aria-label*="file"], [title*="file"]');
          console.log('[ChatKit] Elements with attachment-related attributes:', attachmentElements.length);
          attachmentElements.forEach((elem, idx) => {
            console.log(`[ChatKit] Attachment element ${idx}:`, {
              tagName: elem.tagName,
              className: elem.className,
              ariaLabel: elem.getAttribute('aria-label'),
              title: elem.getAttribute('title'),
              hidden: elem.hasAttribute('hidden'),
              display: getComputedStyle(elem).display
            });
          });
        }
        
        // Avoid calling setOptions directly here; the React wrapper applies options
        
        // Check element's internal state if accessible
        if (el._options || el.options || el.config) {
          console.log('[ChatKit] Element internal options/config:', {
            has_options: !!el._options,
            has_options_prop: !!el.options,
            has_config: !!el.config
          });
        }
        
        console.log('[ChatKit] Element styles:', {
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
          opacity: getComputedStyle(el).opacity,
          height: getComputedStyle(el).height,
          width: getComputedStyle(el).width
        });
      } else {
        console.warn('[ChatKit] No ChatKit element found in DOM');
      }
    };
    
    // Check immediately, after a short delay, and after longer delay
    checkElement();
    setTimeout(() => {
      console.log('[ChatKit] Re-checking after 500ms...');
      checkElement();
    }, 500);
    setTimeout(() => {
      console.log('[ChatKit] Re-checking after 2000ms...');
      checkElement();
    }, 2000);
  }, [sessionData, composerConfig]);

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