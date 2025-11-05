import React from 'react';
import ReactDOM from 'react-dom/client';
import ChatInterface from './AppSDK';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ChatInterface user={{ email: 'test@example.com' }} />
  </React.StrictMode>
);

