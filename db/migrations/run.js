// db/migrations/run.js
const fs = require('fs');
const path = require('path');

async function runMigrations(db) {
  // Ensure migrations tracking table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      executed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const check = await db.execute({
      sql: 'SELECT id FROM _migrations WHERE filename = ?',
      args: [file],
    });
    if (check.rows.length > 0) {
      console.log(`[migrate] skip ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      try {
        await db.execute(stmt);
      } catch (err) {
        // Ignore "already exists" errors for idempotent migrations
        if (!err.message.includes('already exists') && !err.message.includes('duplicate column')) {
          console.error(`[migrate] error in ${file}:`, err.message);
          throw err;
        }
      }
    }

    await db.execute({
      sql: 'INSERT INTO _migrations (filename) VALUES (?)',
      args: [file],
    });
    console.log(`[migrate] applied ${file}`);
  }

  console.log('[migrate] all migrations up to date');
}

if (require.main === module) {
  const { db } = require('../init');
  runMigrations(db).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
