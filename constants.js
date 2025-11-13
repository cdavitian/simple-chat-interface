/**
 * Application Constants
 * 
 * This file contains all application-wide constants to ensure consistency
 * across the codebase and make it easier to maintain and update values.
 */

/**
 * User Type Constants
 * 
 * These constants define the available user types in the system.
 * They correspond to the user_type field in the users table.
 */
const USER_TYPE = {
    NEW: 'New',
    STANDARD: 'Standard', 
    ADMIN: 'Admin'
};

/**
 * User Type Options
 * 
 * Array of all available user types for easy iteration and validation
 */
const USER_TYPE_OPTIONS = [
    USER_TYPE.NEW,
    USER_TYPE.STANDARD,
    USER_TYPE.ADMIN
];

/**
 * User Type Validation
 * 
 * Helper function to validate if a given value is a valid user type
 * @param {string} userType - The user type to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidUserType(userType) {
    return USER_TYPE_OPTIONS.includes(userType);
}

/**
 * Get User Type Display Name
 * 
 * Helper function to get a display-friendly name for user types
 * @param {string} userType - The user type
 * @returns {string} - Display name for the user type
 */
function getUserTypeDisplayName(userType) {
    const displayNames = {
        [USER_TYPE.NEW]: 'New User',
        [USER_TYPE.STANDARD]: 'Standard User',
        [USER_TYPE.ADMIN]: 'Administrator'
    };
    return displayNames[userType] || userType;
}

/**
 * Chatbot Status Constants
 * 
 * These constants define the available chatbot statuses in the system.
 * They correspond to the status field in the chatbots table.
 */
const CHATBOT_STATUS = {
    PROD: 'Prod',
    TEST: 'Test',
    INACTIVE: 'Inactive'
};

/**
 * Chatbot Status Options
 * 
 * Array of all available chatbot statuses for easy iteration and validation
 */
const CHATBOT_STATUS_OPTIONS = [
    CHATBOT_STATUS.PROD,
    CHATBOT_STATUS.TEST,
    CHATBOT_STATUS.INACTIVE
];

/**
 * Chatbot Status Validation
 * 
 * Helper function to validate if a given value is a valid chatbot status
 * @param {string} status - The chatbot status to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidChatbotStatus(status) {
    return CHATBOT_STATUS_OPTIONS.includes(status);
}

/**
 * Get Chatbot Status Display Name
 * 
 * Helper function to get a display-friendly name for chatbot statuses
 * @param {string} status - The chatbot status
 * @returns {string} - Display name for the chatbot status
 */
function getChatbotStatusDisplayName(status) {
    const displayNames = {
        [CHATBOT_STATUS.PROD]: 'Production',
        [CHATBOT_STATUS.TEST]: 'Test',
        [CHATBOT_STATUS.INACTIVE]: 'Inactive'
    };
    return displayNames[status] || status;
}

// Export constants for both CommonJS and ES6 module systems
if (typeof module !== 'undefined' && module.exports) {
    // CommonJS (Node.js)
    module.exports = {
        USER_TYPE,
        USER_TYPE_OPTIONS,
        isValidUserType,
        getUserTypeDisplayName,
        CHATBOT_STATUS,
        CHATBOT_STATUS_OPTIONS,
        isValidChatbotStatus,
        getChatbotStatusDisplayName
    };
} else {
    // Browser/ES6 modules
    window.Constants = {
        USER_TYPE,
        USER_TYPE_OPTIONS,
        isValidUserType,
        getUserTypeDisplayName,
        CHATBOT_STATUS,
        CHATBOT_STATUS_OPTIONS,
        isValidChatbotStatus,
        getChatbotStatusDisplayName
    };
}
