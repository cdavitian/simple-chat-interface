// Shared menu bar functionality for HTML pages
// This script should be included on all pages except login.html

// Expose functions globally
window.createMenuBar = function(user) {
  const menuBar = document.createElement('div');
  menuBar.className = 'menu-bar';
  menuBar.innerHTML = `
    <a href="/" class="menu-bar-logo">
      <svg width="120" height="40" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
        <!-- Kyo text -->
        <text x="5" y="28" fontFamily="serif" fontSize="24" fontWeight="600" fill="#0F4C5C">
          Kyo
        </text>
        <!-- Geometric triangle design - simplified representation -->
        <g transform="translate(50, 8)">
          <polygon points="0,12 6,0 12,12" fill="#0F4C5C" opacity="0.8" />
          <polygon points="2,14 8,2 14,14" fill="#00A8E8" opacity="0.7" />
          <polygon points="4,16 10,4 16,16" fill="#4ECDC4" opacity="0.6" />
        </g>
      </svg>
    </a>
    
    <div class="menu-bar-right">
      <div class="user-info" id="menuBarUserInfo" style="display: none;">
        <img
          id="menuBarUserPhoto"
          src="/public/default-avatar.png"
          alt="User"
          class="user-photo"
        />
        <span class="user-name" id="menuBarUserName">User</span>
        <a href="/admin" class="admin-btn" id="menuBarAdminBtn" style="display: none;">Admin</a>
        <a href="/logout" class="logout-btn">Logout</a>
      </div>
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span class="status-text">Online</span>
      </div>
    </div>
  `;

  // Insert menu bar at the beginning of body
  // Wait for body to exist if needed
  if (document.body) {
    document.body.insertBefore(menuBar, document.body.firstChild);
    // Add padding to body to account for fixed menu bar
    document.body.style.paddingTop = '56px';
  } else {
    // If body doesn't exist yet, wait for DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.insertBefore(menuBar, document.body.firstChild);
        document.body.style.paddingTop = '56px';
      });
    }
  }

  // Update user info when user data is available
  if (user && window.updateMenuBarUserInfo) {
    window.updateMenuBarUserInfo(user);
  }

  return menuBar;
};

window.updateMenuBarUserInfo = function(user) {
  const userInfo = document.getElementById('menuBarUserInfo');
  const userPhoto = document.getElementById('menuBarUserPhoto');
  const userName = document.getElementById('menuBarUserName');
  const adminBtn = document.getElementById('menuBarAdminBtn');

  if (user && userInfo) {
    if (userPhoto) {
      userPhoto.src = user.picture || user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=667eea&color=fff&size=32`;
    }
    if (userName) {
      userName.textContent = user.name || 'User';
    }
    if (adminBtn && user.userType === 'Admin') {
      adminBtn.style.display = 'inline-block';
    } else if (adminBtn) {
      adminBtn.style.display = 'none';
    }
    userInfo.style.display = 'flex';
  }
};

