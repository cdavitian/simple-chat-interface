const LoggingConfig = require('./logging-config');
require('dotenv').config();

async function updateUserTypeCase() {
    const loggingConfig = new LoggingConfig();
    
    try {
        console.log('Starting user_type case update...');
        
        // Check if users table exists
        const checkTableSQL = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `;
        
        const tableExists = await loggingConfig.logger.pool.query(checkTableSQL);
        
        if (!tableExists.rows[0].exists) {
            console.log('Users table does not exist, no update needed');
            return;
        }
        
        // Check current user_type values
        const checkValuesSQL = `
            SELECT user_type, COUNT(*) as count
            FROM users 
            GROUP BY user_type
        `;
        
        const currentValues = await loggingConfig.logger.pool.query(checkValuesSQL);
        console.log('Current user_type values:', currentValues.rows);
        
        // Update 'new' to 'New'
        const updateSQL = `
            UPDATE users 
            SET user_type = 'New', updated_at = CURRENT_TIMESTAMP
            WHERE user_type = 'new'
        `;
        
        const result = await loggingConfig.logger.pool.query(updateSQL);
        console.log(`✅ Updated ${result.rowCount} users from 'new' to 'New'`);
        
        // Verify the update
        const verifySQL = `
            SELECT user_type, COUNT(*) as count
            FROM users 
            GROUP BY user_type
        `;
        
        const updatedValues = await loggingConfig.logger.pool.query(verifySQL);
        console.log('Updated user_type values:', updatedValues.rows);
        
        console.log('✅ User type case update completed successfully');
        
    } catch (error) {
        console.error('Error updating user type case:', error);
    } finally {
        if (loggingConfig.logger && loggingConfig.logger.pool) {
            await loggingConfig.logger.pool.end();
        }
    }
}

// Run the update
updateUserTypeCase();
