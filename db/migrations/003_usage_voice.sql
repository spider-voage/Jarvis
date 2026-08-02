-- Migration 003: Usage tracking and voice sessions

CREATE TABLE IF NOT EXISTS usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  messages_sent INTEGER DEFAULT 0,
  messages_received INTEGER DEFAULT 0,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  voice_minutes_used REAL DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  transcript TEXT,
  response_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_stats_user_date ON usage_stats(user_id, date);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
