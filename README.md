# Simple Chat Interface

A modern, responsive chat interface with AWS Cognito authentication, built with HTML, CSS, JavaScript, and Node.js.

## Features

- 🔐 **AWS Cognito Authentication**: Secure login with AWS Cognito user pool
- 🏢 **Domain Restriction**: Access limited to kyocare.com users only
- 🎨 **Modern Design**: Clean, responsive interface with beautiful gradients
- 💬 **Real-time Chat**: Send messages with Enter key or send button
- 🤖 **Bot Responses**: Simulated bot responses with realistic typing delays
- 📱 **Mobile Responsive**: Works perfectly on desktop and mobile devices
- ✨ **Smooth Animations**: Messages slide in with smooth transitions
- 🕒 **Timestamps**: All messages include timestamps
- 👤 **User Profile**: Display user photo, name, and logout option

## Getting Started

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd Chat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up AWS Cognito (see [SETUP.md](SETUP.md) for detailed instructions)

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000`

6. Sign in with your Google account (kyocare.com email required)

7. Start chatting! Type a message and press Enter or click the send button.

## Files Structure

```
Chat/
├── index.html          # Main HTML structure
├── login.html          # Login page with Google OAuth
├── styles.css          # CSS styling and animations
├── script.js           # JavaScript functionality
├── server.js           # Node.js server with authentication
├── package.json        # Dependencies and scripts
├── env.example         # Environment variables template
├── SETUP.md            # Detailed setup instructions
└── README.md           # This file
```

## How It Works

- **HTML**: Provides the structure with a chat container, messages area, and input field
- **CSS**: Styling with modern gradients, animations, and responsive design
- **JavaScript**: Handles user interactions, message sending, and bot responses
- **Node.js Server**: Handles authentication, session management, and API endpoints
- **AWS Cognito**: Secure authentication with domain restriction

## Customization

You can easily customize the chat interface by:

- Modifying colors and gradients in `styles.css`
- Adding new bot response patterns in `script.js`
- Connecting to a real backend API
- Adding more sophisticated features like file uploads, emoji support, etc.

## Browser Support

This chat interface works in all modern browsers including:
- Chrome
- Firefox
- Safari
- Edge

## License

This project is open source and available under the MIT License.
