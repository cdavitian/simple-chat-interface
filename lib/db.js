const { Pool } = require('pg');

const {
  DATABASE_URL,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_SSL,
} = process.env;

const baseConfig = {};

if (DATABASE_URL) {
  baseConfig.connectionString = DATABASE_URL;
} else if (DB_HOST || DB_NAME || DB_USER || DB_PASSWORD) {
  Object.assign(baseConfig, {
    host: DB_HOST,
    port: DB_PORT ? Number(DB_PORT) : undefined,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });
} else {
  console.warn('⚠️  Database configuration missing. Set DATABASE_URL or DB_* env vars.');
}

const sslEnabled = typeof DB_SSL === 'string'
  ? ['1', 'true', 'TRUE', 'require', 'required'].includes(DB_SSL)
  : false;

if (sslEnabled) {
  baseConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(baseConfig);

module.exports = {
  pool,
};

