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
            <button 
              className="admin-btn"
              onClick={() => window.location.href = '/admin'}
            >
              Admin
            </button>
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
  console.log('ChatKitComponent received sessionData:', sessionData);
  
  const { control } = useChatKit({
    api: {
      getClientSecret: async (currentClientSecret) => {
        console.log('getClientSecret called with:', currentClientSecret);
        console.log('Returning clientToken:', sessionData?.clientToken);
        return sessionData?.clientToken;
      }
    }
  });

  console.log('ChatKit control:', control);

  // Debug: Check element after render
  useEffect(() => {
    const checkElement = () => {
      const el = document.querySelector('openai-chatkit');
      console.log('ChatKit element found:', el);
      if (el) {
        const rect = el.getBoundingClientRect();
        console.log('Element bounds:', rect);
        console.log('Shadow DOM:', el.shadowRoot?.querySelector('*'));
        console.log('Element styles:', getComputedStyle(el).cssText);
        
        // Try to manually set options if shadow DOM is missing
        if (!el.shadowRoot && sessionData?.clientToken) {
          console.log('Attempting to manually set options...');
          try {
            el.setOptions({ api: { clientToken: sessionData.clientToken } });
            console.log('Manual setOptions completed');
          } catch (error) {
            console.error('Manual setOptions failed:', error);
          }
        }
      } else {
        console.log('No ChatKit element found in DOM');
      }
    };
    
    // Check immediately and after a delay
    checkElement();
    setTimeout(checkElement, 1000);
  }, [sessionData]);

  return (
    <div style={{ width: '100%', height: '600px', display: 'block' }}>
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