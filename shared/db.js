const { Pool } = require('pg');
const { db } = require('./config');

const pool = new Pool({
  connectionString: db.connectionString
});

let isClosed = false;

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (isClosed) {
    return;
  }

  isClosed = true;
  await pool.end();
}

module.exports = {
  query,
  withTransaction,
  closePool
};

// Made with Bob
