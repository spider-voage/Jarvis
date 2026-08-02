-- Migration 004: Admin and announcements

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error')),
  is_active INTEGER DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Add plan_id to users for quick lookup
ALTER TABLE users ADD COLUMN current_plan_id INTEGER REFERENCES subscription_plans(id);
ALTER TABLE users ADD COLUMN is_disabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN disabled_reason TEXT;
ALTER TABLE users ADD COLUMN disabled_at TEXT;
