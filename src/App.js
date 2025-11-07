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
  
  // Composer configuration - disable attachments
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
  // Get the send method directly from useChatKit
  const chatkit = useChatKit({
    api: {
      getClientSecret: getClientSecret
    },
    composer: composerConfig
  });
  
  const { control } = chatkit;

  console.log('[ChatKit] 🔐 useChatKit hook returned control:', control);
  console.log('[ChatKit] 🔐 Control methods available:', control ? Object.keys(control) : 'control is null/undefined');
  
  // Log when control is first available
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
    } else {
      console.warn('[ChatKit] ⚠️ Control object is not available yet');
    }
  }, [control, composerConfig]);
  
  // Hide composer elements (input field and send button) after ChatKit renders
  useEffect(() => {
    const hideComposer = () => {
      const el = document.querySelector('openai-chatkit');
      if (!el?.shadowRoot) {
        return false;
      }
      
      // Find and hide the composer container/elements
      // Try multiple selectors to find the composer
      const composerSelectors = [
        '[class*="composer"]',
        '[class*="Composer"]',
        '[class*="input-container"]',
        '[class*="InputContainer"]',
        'form',
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]',
        'button[type="submit"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="Send" i]'
      ];
      
      let hidden = false;
      composerSelectors.forEach(selector => {
        const elements = el.shadowRoot.querySelectorAll(selector);
        elements.forEach(elem => {
          // Check if element is likely part of the composer
          const isComposer = elem.closest('[class*="composer"]') || 
                           elem.closest('form') ||
                           elem.tagName === 'TEXTAREA' ||
                           elem.tagName === 'INPUT' ||
                           (elem.tagName === 'BUTTON' && (
                             elem.getAttribute('type') === 'submit' ||
                             elem.getAttribute('aria-label')?.toLowerCase().includes('send')
                           ));
          
          if (isComposer) {
            elem.style.display = 'none';
            elem.style.visibility = 'hidden';
            elem.style.opacity = '0';
            elem.style.height = '0';
            elem.style.padding = '0';
            elem.style.margin = '0';
            elem.setAttribute('disabled', 'true');
            elem.setAttribute('aria-hidden', 'true');
            hidden = true;
          }
        });
      });
      
      // Also try to find parent composer container
      const allElements = el.shadowRoot.querySelectorAll('*');
      allElements.forEach(elem => {
        const className = elem.className?.toLowerCase() || '';
        const id = elem.id?.toLowerCase() || '';
        
        if ((className.includes('composer') || 
             className.includes('input') ||
             id.includes('composer') ||
             id.includes('input')) &&
            !className.includes('message') && 
            !id.includes('message')) {
          elem.style.display = 'none';
          elem.style.visibility = 'hidden';
          elem.style.opacity = '0';
          elem.style.height = '0';
          elem.style.padding = '0';
          elem.style.margin = '0';
          hidden = true;
        }
      });
      
      return hidden;
    };
    
    // Try multiple times with delays to catch ChatKit when it renders
    const timeouts = [100, 300, 500, 1000, 2000, 3000];
    timeouts.forEach(delay => {
      setTimeout(() => {
        const hidden = hideComposer();
        if (hidden) {
          console.log(`[ChatKit] ✅ Composer hidden successfully (delay: ${delay}ms)`);
        }
      }, delay);
    });
    
    // Also use MutationObserver to catch dynamic additions
    const el = document.querySelector('openai-chatkit');
    if (el?.shadowRoot) {
      const observer = new MutationObserver(() => {
        hideComposer();
      });
      
      observer.observe(el.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: false
      });
      
      return () => {
        observer.disconnect();
      };
    }
  }, [sessionData?.sessionId]);

  // CENTRALIZED MESSAGE SEND FUNCTION
  // All messages must go through this function - no direct ChatKit API calls allowed
  const sendUserPrompt = useCallback(async (event) => {
    console.log('[ChatKit] 🚀🚀🚀 sendUserPrompt CALLED 🚀🚀🚀', { event, hasSessionId: !!sessionData?.sessionId });
    try {
      // Prevent form submit or default key handling
      event?.preventDefault?.();
      event?.stopPropagation?.();

      if (!sessionData?.sessionId) {
        console.error('[ChatKit] ❌ Cannot send: no sessionId');
        return;
      }

      // Get the input element from ChatKit's shadow DOM
      const el = document.querySelector('openai-chatkit');
      if (!el?.shadowRoot) {
        console.error('[ChatKit] ❌ Cannot send: ChatKit element not found');
        return;
      }

      const composerInput = el.shadowRoot.querySelector('textarea, input[type="text"], [contenteditable="true"]');
      if (!composerInput) {
        console.error('[ChatKit] ❌ Cannot send: composer input not found');
        return;
      }

      // Grab current input text
      const userPrompt = composerInput.value?.trim() || 
                         composerInput.textContent?.trim() || 
                         '';

      // Build content array: text + any staged files
      const content = fileStager.toMessageContent(userPrompt);

      if (content.length === 0) {
        console.log('[ChatKit] ⚠️ No content to send (no text and no staged files) - RETURNING EARLY');
        console.log('[ChatKit] Debug:', { userPrompt, contentLength: content.length, stagedCount: fileStager.list().length });
        return;
      }

      console.log('[ChatKit] 📤 [SEND] Outgoing content:', content);
      const debugFileIds = fileStager.list();
      const debugFilesMeta = fileStager.listWithMetadata();
      console.log('[ChatKit][DEBUG] staged_file_ids:', debugFileIds);
      console.log('[ChatKit][DEBUG] staged_files:', debugFilesMeta);

      // Send the user message to the current session via our controlled endpoint
      const debugQuery = debugFileIds.length ? `?file_ids=${encodeURIComponent(debugFileIds.join(','))}` : '';
      const url = `/api/chatkit/message${debugQuery}`;
      const payload = {
        session_id: sessionData.sessionId,
        text: userPrompt || undefined,
        staged_file_ids: fileStager.list(),
        staged_files: fileStager.listWithMetadata()  // Send metadata for content type routing
      };
      console.log('[ChatKit][NETWORK] About to POST:', { url, method: 'POST', payload });
      console.log('[ChatKit][NETWORK] ⚡⚡⚡ FETCH CALL STARTING ⚡⚡⚡');
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-File-Ids': debugFileIds.join(','),
            'X-Debug-File-Count': String(debugFileIds.length)
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        console.log('[ChatKit][NETWORK] ✅ POST request completed, response status:', resp.status);
      } catch (fetchError) {
        console.error('[ChatKit][NETWORK] ❌ FETCH ERROR:', fetchError);
        throw fetchError;
      }

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error('[ChatKit] ❌ Message send failed:', errorText);
        throw new Error(`Failed to send message: ${resp.status} ${errorText}`);
      }

      const result = await resp.json();
      console.log('[ChatKit] ✅ [SEND] Message sent successfully:', result);

      // Clear the local input and staged files
      composerInput.value = '';
      if (composerInput.textContent) composerInput.textContent = '';
      fileStager.clear();

      // Trigger input event so ChatKit UI updates
      composerInput.dispatchEvent(new Event('input', { bubbles: true }));
      
    } catch (err) {
      console.error('[ChatKit] ❌ sendUserPrompt failed:', err);
    }
  }, [sessionData?.sessionId]);

  // Block all direct ChatKit message API calls - force everything through our controlled endpoint
  useEffect(() => {
    if (!sessionData?.sessionId) {
      return;
    }

    console.log('[ChatKit] 🔒 Blocking direct ChatKit message API calls...');

    const originalFetch = window.fetch;
    let blockActive = true;

    const blockingFetch = async (...args) => {
      const [url, options = {}] = args;
      
      // Check if this is a ChatKit message creation request
      const urlString = typeof url === 'string' ? url : url?.toString() || '';
      const method = options.method || 'GET';
      const isChatKitMessageCreate = urlString.includes('/chatkit') && 
                                     (urlString.includes('/messages') || urlString.includes('/conversation')) &&
                                     (method === 'POST' || method === 'PUT');
      
      if (isChatKitMessageCreate && blockActive) {
        console.warn('[ChatKit] 🚫 BLOCKED: Direct ChatKit API call detected:', urlString);
        console.warn('[ChatKit] 🚫 Method:', method);
        console.warn('[ChatKit] 🚫 All messages must go through sendUserPrompt() function');
        
        // Return a rejected promise to prevent the call
        return Promise.reject(new Error('Direct ChatKit message API calls are disabled. Use sendUserPrompt() instead.'));
      }

      // Allow all other requests to proceed normally
      return originalFetch.apply(window, args);
    };

    // Override fetch
    window.fetch = blockingFetch;

    return () => {
      window.fetch = originalFetch;
      blockActive = false;
      console.log('[ChatKit] 🧹 Message blocking removed');
    };
  }, [sessionData?.sessionId]);

  // DOM interceptors: capture all message send attempts and route through sendUserPrompt
  useEffect(() => {
    if (!sessionData?.sessionId) {
      return;
    }

    const attachInterceptIfPossible = () => {
      const el = document.querySelector('openai-chatkit');
      console.log('[ChatKit] 🔍 Checking for ChatKit element:', { found: !!el, tagName: el?.tagName });
      if (!el) {
        console.log('[ChatKit] ⏳ ChatKit element not found yet');
        return false;
      }

      console.log('[ChatKit] 🔍 Checking shadow root:', { hasShadowRoot: !!el.shadowRoot, shadowRootMode: el.shadowRoot?.mode });
      if (!el.shadowRoot) {
        console.log('[ChatKit] ⏳ ChatKit shadow root not available yet');
        // Check if it's in an iframe
        const iframe = el.closest('iframe');
        if (iframe) {
          console.warn('[ChatKit] ⚠️ ChatKit element is inside an iframe - cannot access shadow DOM from parent page');
        }
        return false;
      }

      // Find the composer input
      const composerInput = el.shadowRoot.querySelector('textarea, input[type="text"], [contenteditable="true"]');
      console.log('[ChatKit] 🔍 Checking composer input:', { found: !!composerInput, tagName: composerInput?.tagName });
      if (!composerInput) {
        // Try to find any input-like elements for debugging
        const allInputs = el.shadowRoot.querySelectorAll('*');
        console.log('[ChatKit] 🔍 Shadow DOM contains', allInputs.length, 'elements');
        const inputLike = Array.from(allInputs).filter(el => 
          el.tagName === 'TEXTAREA' || 
          el.tagName === 'INPUT' || 
          el.contentEditable === 'true' ||
          el.getAttribute('contenteditable') === 'true'
        );
        console.log('[ChatKit] 🔍 Found', inputLike.length, 'input-like elements:', inputLike.map(el => ({ tag: el.tagName, id: el.id, class: el.className })));
      }
      if (!composerInput) {
        console.log('[ChatKit] ⏳ Composer input not found');
        return false;
      }

      // Avoid duplicate listeners
      if (composerInput._fileStagerInterceptAttached) {
        console.log('[ChatKit] ✅ Intercept already attached to this input');
        return true;
      }

      console.log('[ChatKit] 🔧 Attaching intercept to composer input');

      // Intercept Enter key - route through sendUserPrompt
      const keydownHandler = async (evt) => {
        if (evt.key === 'Enter' && !evt.shiftKey) {
          console.log('[ChatKit] ⌨️ Enter pressed, routing through sendUserPrompt');
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          await sendUserPrompt(evt);
        }
      };

      // Intercept send button clicks - route through sendUserPrompt
      const clickHandler = async (evt) => {
        const target = evt.target;
        // Look for send button (common patterns)
        if (target.closest('button[type="submit"]') || 
            target.closest('button')?.ariaLabel?.toLowerCase().includes('send') ||
            target.closest('[role="button"]')?.getAttribute('aria-label')?.toLowerCase().includes('send')) {
          
          console.log('[ChatKit] 🖱️ Send button clicked, routing through sendUserPrompt');
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          await sendUserPrompt(evt);
        }
      };

      // Intercept form submissions - route through sendUserPrompt
      const formSubmitHandler = async (evt) => {
        if (evt.target.tagName === 'FORM' || evt.target.closest('form')) {
          console.log('[ChatKit] 📝 Form submit intercepted, routing through sendUserPrompt');
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          await sendUserPrompt(evt);
        }
      };

      // Attach all handlers
      composerInput.addEventListener('keydown', keydownHandler, { capture: true, passive: false });
      el.shadowRoot.addEventListener('click', clickHandler, { capture: true, passive: false });
      el.shadowRoot.addEventListener('submit', formSubmitHandler, { capture: true, passive: false });
      
      // Also watch for any message sending events via MutationObserver (fallback)
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          // If ChatKit is trying to send a message, we want to intercept it
          // This is a fallback in case our other intercepts miss it
        });
      });

      // Observe the shadow root for changes
      observer.observe(el.shadowRoot, {
        childList: true,
        subtree: true,
        attributes: false
      });

      // Store observer for cleanup
      composerInput._fileStagerObserver = observer;
      composerInput._fileStagerInterceptAttached = true;
      console.log('[ChatKit] ✅ Message intercept attached successfully');
      return true;
    };

    // Try multiple times with increasing delays
    const timeouts = [0, 300, 1000, 2000, 3000];
    let attached = false;
    const attempts = [];

    timeouts.forEach((t) => {
      const timeoutId = setTimeout(() => {
        if (!attached) {
          console.log(`[ChatKit] 🔄 Attempting to attach intercept (delay: ${t}ms)...`);
          attached = attachInterceptIfPossible();
          if (attached) {
            console.log('[ChatKit] ✅ Intercept attached on attempt');
          }
        }
      }, t);
      attempts.push(timeoutId);
    });

    // Global intercept as last resort (catches events that bubble up)
    const globalKeydownHandler = async (evt) => {
      // Check if we're in the ChatKit context
      const el = document.querySelector('openai-chatkit');
      if (!el) return;

      // Check if the event is coming from ChatKit's shadow DOM
      // We can't use contains() for shadow DOM, so check if active element is in ChatKit
      const activeEl = document.activeElement;
      if (activeEl !== el && !el.contains(activeEl)) {
        // Also check if event target might be from shadow DOM (event.composedPath)
        const path = evt.composedPath?.() || [];
        const isFromChatKit = path.some(node => node === el || (node?.host === el));
        if (!isFromChatKit) return;
      }

      if (evt.key === 'Enter' && !evt.shiftKey) {
        const shadowRoot = el.shadowRoot;
        if (!shadowRoot) return;

        const composerInput = shadowRoot.querySelector('textarea, input[type="text"], [contenteditable="true"]');
        if (!composerInput) return;
        
        // Only use global intercept if shadow DOM intercept wasn't attached
        if (!composerInput._fileStagerInterceptAttached) {
          const text = composerInput?.value?.trim() || composerInput?.textContent?.trim() || '';
          if (text || fileStager.list().length > 0) {
            console.log('[ChatKit] 🌐 Global intercept triggered as fallback, routing through sendUserPrompt');
            await sendUserPrompt(evt);
          }
        }
      }
    };

    // Add global listener with high priority
    window.addEventListener('keydown', globalKeydownHandler, { capture: true, passive: false });

    return () => {
      attempts.forEach(id => clearTimeout(id));
      window.removeEventListener('keydown', globalKeydownHandler, { capture: true });
      
      const el = document.querySelector('openai-chatkit');
      if (el?.shadowRoot) {
        const composerInput = el.shadowRoot.querySelector('textarea, input[type="text"], [contenteditable="true"]');
        if (composerInput) {
          if (composerInput._fileStagerObserver) {
            composerInput._fileStagerObserver.disconnect();
            delete composerInput._fileStagerObserver;
          }
          if (composerInput._fileStagerInterceptAttached) {
            delete composerInput._fileStagerInterceptAttached;
          }
        }
      }
    };
  }, [sessionData?.sessionId, sendUserPrompt]);

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