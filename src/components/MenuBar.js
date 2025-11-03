import React from 'react';
import './MenuBar.css';

const MenuBar = ({ user }) => {
  return (
    <div className="menu-bar">
      <a href="https://simple-chat-interface-staging.up.railway.app/homepage" className="menu-bar-logo">
        <svg width="180" height="60" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
          {/* Kyo text */}
          <text x="5" y="28" fontFamily="serif" fontSize="24" fontWeight="600" fill="#0F4C5C">
            Kyo
          </text>
          {/* Geometric triangle design - simplified representation */}
          <g transform="translate(50, 8)">
            <polygon points="0,12 6,0 12,12" fill="#0F4C5C" opacity="0.8" />
            <polygon points="2,14 8,2 14,14" fill="#00A8E8" opacity="0.7" />
            <polygon points="4,16 10,4 16,16" fill="#4ECDC4" opacity="0.6" />
          </g>
        </svg>
      </a>
      
      <div className="menu-bar-right">
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
  );
};

export default MenuBar;

