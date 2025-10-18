import React from 'react';

function App() {
  return (
    <div style={{ 
      padding: '20px', 
      textAlign: 'center',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f0f0f0',
      minHeight: '100vh'
    }}>
      <h1>Minimal React Test</h1>
      <p>This is the most minimal React app possible.</p>
      <p>No state, no effects, no animations, no external dependencies.</p>
      <p>If this blinks, the issue is with React itself or the build process.</p>
    </div>
  );
}

export default App;
