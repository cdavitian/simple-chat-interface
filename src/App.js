import React, { useState, useEffect, useRef } from 'react';
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import './App.css';

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
      
      // Get session data from server
      console.log('Making request to /api/chatkit/session...');
      const response = await fetch('/api/chatkit/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include' // Ensure cookies are sent
      });
      
      console.log('ChatKit session response status:', response.status);
      console.log('Response URL:', response.url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('ChatKit session error:', errorText);
        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
        throw new Error(`Session error: ${response.status} - ${errorText}`);
      }
      
      const sessionData = await response.json();
      console.log('ChatKit session data received:', sessionData);
      
      // Store session data and mark as initialized
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
              src={user?.picture || '/public/default-avatar.png'} 
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
          <ChatKitComponent sessionData={sessionData} />
        )}
      </div>
    </div>
  );
}

function ChatKitComponent({ sessionData }) {
  console.log('[ChatKit] Component rendering with sessionData:', sessionData);
  
  // Composer configuration with attachments enabled
  const composerConfig = {
    attachments: {
      enabled: true,
    },
  };
  
  console.log('[ChatKit] Composer configuration:', JSON.stringify(composerConfig, null, 2));
  
  const { control } = useChatKit({
    api: {
      getClientSecret: async (currentClientSecret) => {
        console.log('[ChatKit] getClientSecret called with:', currentClientSecret);
        console.log('[ChatKit] Returning clientToken:', sessionData?.clientToken?.substring(0, 20) + '...');
        return sessionData?.clientToken;
      }
    }
  });

  console.log('[ChatKit] useChatKit hook returned control:', control);
  console.log('[ChatKit] Control methods available:', control ? Object.keys(control) : 'control is null/undefined');

  // Debug: Check element after render and inspect ChatKit state
  useEffect(() => {
    console.log('[ChatKit] useEffect triggered, checking ChatKit element...');
    
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
        
        // Check if element has setOptions method
        if (typeof el.setOptions === 'function') {
          console.log('[ChatKit] Element has setOptions method');
          
          // Try to get current options
          if (typeof el.getOptions === 'function') {
            try {
              const currentOptions = el.getOptions();
              console.log('[ChatKit] Current ChatKit options:', JSON.stringify(currentOptions, null, 2));
            } catch (err) {
              console.log('[ChatKit] Could not get current options:', err.message);
            }
          }
          
          // Try to set composer config via setOptions as alternative
          console.log('[ChatKit] Attempting to set composer config via setOptions...');
          try {
            el.setOptions({
              composer: composerConfig
            });
            console.log('[ChatKit] setOptions call completed successfully');
          } catch (error) {
            console.error('[ChatKit] setOptions failed:', error);
          }
        } else {
          console.log('[ChatKit] Element does not have setOptions method');
        }
        
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

  console.log('[ChatKit] Rendering ChatKit component with props:', {
    hasControl: !!control,
    composerConfig: composerConfig
  });

  return (
    <div style={{ width: '100%', height: '600px', display: 'block' }}>
      <ChatKit 
        control={control}
        composer={composerConfig}
        style={{ 
          height: '600px', 
          width: '100%', 
          display: 'block',
          minHeight: '600px',
          minWidth: '360px'
        }}
        onError={(error) => {
          console.error('[ChatKit] ChatKit error event:', error);
        }}
      />
    </div>
  );
}

export default App;