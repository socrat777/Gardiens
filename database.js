const { Pool } = require("pg");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    })
  : null;

async function getDatabaseStatus() {
  if (!pool) {
    return {
      configured: false,
      connected: false
    };
  }

  try {
    await pool.query("SELECT 1");

    return {
      configured: true,
      connected: true
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.message
    };
  }
}

module.exports = {
  pool,
  getDatabaseStatus
};