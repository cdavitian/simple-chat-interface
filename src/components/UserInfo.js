import React from 'react';

const UserInfo = ({ user, onLogout }) => {
  if (!user) {
    return null;
  }

  return (
    <div className="user-info">
      <img 
        className="user-photo" 
        src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=667eea&color=fff&size=32`}
        alt={user.name}
      />
      <span className="user-name">{user.name}</span>
      <button 
        className="logout-btn" 
        onClick={onLogout}
        title="Logout"
      >
        Logout
      </button>
    </div>
  );
};

export default UserInfo;
