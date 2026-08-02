-- Migration 002: Subscriptions and billing

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  interval TEXT DEFAULT 'month' CHECK (interval IN ('month', 'year', 'lifetime')),
  features_json TEXT DEFAULT '{}',
  daily_message_limit INTEGER DEFAULT 50,
  max_context_messages INTEGER DEFAULT 30,
  voice_enabled INTEGER DEFAULT 0,
  advanced_models INTEGER DEFAULT 0,
  file_analysis INTEGER DEFAULT 0,
  priority_support INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'expired')),
  current_period_start TEXT,
  current_period_end TEXT,
  trial_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  cancelled_at TEXT,
  payment_provider TEXT,
  provider_subscription_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  description TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  due_date TEXT,
  paid_at TEXT,
  pdf_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);

-- Seed default plans
INSERT OR IGNORE INTO subscription_plans (slug, name, description, price_cents, interval, daily_message_limit, max_context_messages, voice_enabled, advanced_models, file_analysis, priority_support, features_json)
VALUES ('free', 'Free', 'Text chat with daily limits', 0, 'month', 50, 30, 0, 0, 0, 0, '{"chat": true, "voice": false, "file_analysis": false, "advanced_models": false}');

INSERT OR IGNORE INTO subscription_plans (slug, name, description, price_cents, interval, daily_message_limit, max_context_messages, voice_enabled, advanced_models, file_analysis, priority_support, features_json)
VALUES ('pro', 'Pro', 'Unlimited chat, voice, and premium models', 999, 'month', 999999, 100, 1, 1, 1, 1, '{"chat": true, "voice": true, "file_analysis": true, "advanced_models": true, "priority": true}');
