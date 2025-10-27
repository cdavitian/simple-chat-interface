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

// Export constants for both CommonJS and ES6 module systems
if (typeof module !== 'undefined' && module.exports) {
    // CommonJS (Node.js)
    module.exports = {
        USER_TYPE,
        USER_TYPE_OPTIONS,
        isValidUserType,
        getUserTypeDisplayName
    };
} else {
    // Browser/ES6 modules
    window.Constants = {
        USER_TYPE,
        USER_TYPE_OPTIONS,
        isValidUserType,
        getUserTypeDisplayName
    };
}
