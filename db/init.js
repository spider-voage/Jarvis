// db/init.js
// Uses @libsql/client — works with local file DB (dev) or hosted Turso (production)

const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient({ url, authToken });

async function initDb() {
  const { runMigrations } = require('./migrations/run');
  await runMigrations(db);
  console.log(`[db] ready (${url})`);
}

module.exports = { db, initDb };
