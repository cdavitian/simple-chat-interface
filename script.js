class ChatInterface {
    constructor() {
        this.messagesContainer = document.getElementById('chatMessages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        
        this.initializeEventListeners();
    }
    
    initializeEventListeners() {
        // Send message on button click
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        // Send message on Enter key press
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Auto-resize input and enable/disable send button
        this.messageInput.addEventListener('input', () => {
            this.updateSendButton();
        });
        
        // Focus input on load
        this.messageInput.focus();
    }
    
    sendMessage() {
        const message = this.messageInput.value.trim();
        
        if (!message) return;
        
        // Add user message to chat
        this.addMessage(message, 'user');
        
        // Clear input
        this.messageInput.value = '';
        this.updateSendButton();
        
        // Simulate bot response
        this.simulateBotResponse(message);
    }
    
    addMessage(text, sender) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        
        const avatar = sender === 'user' ? '👤' : '🤖';
        const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageElement.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-text">${this.escapeHtml(text)}</div>
                <div class="message-time">${currentTime}</div>
            </div>
        `;
        
        this.messagesContainer.appendChild(messageElement);
        this.scrollToBottom();
    }
    
    simulateBotResponse(userMessage) {
        // Disable send button while bot is "thinking"
        this.sendButton.disabled = true;
        this.sendButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
        `;
        
        // Simulate typing delay
        setTimeout(() => {
            const responses = [
                "That's interesting! Tell me more about that.",
                "I understand what you're saying. How do you feel about it?",
                "Thanks for sharing that with me. What else is on your mind?",
                "That sounds great! I'd love to hear more details.",
                "I see what you mean. What made you think of that?",
                "That's a good point. Have you considered other perspectives?",
                "I appreciate you telling me that. How can I help you further?",
                "That's fascinating! What led you to that conclusion?"
            ];
            
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            this.addMessage(randomResponse, 'bot');
            
            // Re-enable send button
            this.sendButton.disabled = false;
            this.sendButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22,2 15,22 11,13 2,9"></polygon>
                </svg>
            `;
            
            this.messageInput.focus();
        }, 1000 + Math.random() * 2000); // Random delay between 1-3 seconds
    }
    
    updateSendButton() {
        const hasText = this.messageInput.value.trim().length > 0;
        this.sendButton.disabled = !hasText;
    }
    
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize chat interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatInterface();
});

// Add some demo functionality
document.addEventListener('DOMContentLoaded', () => {
    // Add welcome message after a short delay
    setTimeout(() => {
        const welcomeMessage = document.querySelector('.bot-message .message-text');
        if (welcomeMessage) {
            welcomeMessage.textContent = "Welcome to the chat! I'm here to help you. Feel free to ask me anything or just have a conversation!";
        }
    }, 500);
});
