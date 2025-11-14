-- Migration script to add slug field to chatbots table
-- This allows chatbots to be accessed via URL paths like /chatkit/{slug}

-- Add slug column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'chatbots' 
        AND column_name = 'slug'
    ) THEN
        ALTER TABLE chatbots ADD COLUMN slug VARCHAR(255) UNIQUE;
        
        -- Create index on slug for fast lookups
        CREATE INDEX IF NOT EXISTS idx_chatbots_slug ON chatbots(slug);
        
        RAISE NOTICE 'Added slug column to chatbots table';
    ELSE
        RAISE NOTICE 'Slug column already exists in chatbots table';
    END IF;
END $$;

