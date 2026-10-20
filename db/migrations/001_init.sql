-- Atalaya. Tiempos en epoch-segundos. Todo lo de un usuario lleva user_id; lo de una tienda, shop_id.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  plan TEXT NOT NULL DEFAULT 'gratis',
  credits INTEGER NOT NULL DEFAULT 0,
  credits_renew_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE invite_tokens (
  token TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  used_by INTEGER,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- Una cuenta de Atalaya puede vigilar varias tiendas (según el plan).
CREATE TABLE shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  poe_account TEXT NOT NULL,
  league TEXT NOT NULL,
  poe_session_enc TEXT,
  big_sale_amount REAL,
  big_sale_currency TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  last_manual_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_shops_user ON shops (user_id);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  listing_key TEXT NOT NULL,
  item_fp TEXT,
  name TEXT,
  base_type TEXT,
  rarity TEXT,
  icon TEXT,
  price_amount REAL,
  price_currency TEXT,
  stats_json TEXT,
  stash_tab TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (shop_id, listing_key)
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok','rate_limited','error','no_data'))
);
CREATE INDEX idx_snapshots_shop ON snapshots (shop_id, taken_at);

CREATE TABLE sale_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  listing_key TEXT NOT NULL,
  first_missing_at INTEGER NOT NULL,
  UNIQUE (shop_id, listing_key)
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT,
  base_type TEXT,
  rarity TEXT,
  icon TEXT,
  price_amount REAL,
  price_currency TEXT,
  ex_value REAL,
  item_fp TEXT,
  listed_since INTEGER,
  detected_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sales_user ON sales (user_id, detected_at);

CREATE TABLE shop_value_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  total_ex REAL,
  item_count INTEGER
);
CREATE INDEX idx_value_shop ON shop_value_history (shop_id, taken_at);

CREATE TABLE wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  league TEXT NOT NULL,
  max_amount REAL NOT NULL,
  max_currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching','found')),
  found_amount REAL,
  found_currency TEXT,
  found_at INTEGER,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE currency_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at INTEGER NOT NULL,
  league TEXT,
  divine_per_exalted REAL,
  chaos_per_exalted REAL,
  source TEXT
);

CREATE TABLE notification_prefs (
  user_id INTEGER PRIMARY KEY,
  push_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE worker_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

-- Créditos: cada movimiento queda apuntado (gasto, devolución, recarga mensual, compra simulada).
CREATE TABLE credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ledger_user ON credit_ledger (user_id, created_at);

-- Tasaciones hechas con IA (sin guardar la captura: solo el texto leído y el resultado).
CREATE TABLE appraisals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('texto','captura')),
  item_name TEXT,
  item_json TEXT,
  result_json TEXT NOT NULL,
  cost INTEGER NOT NULL,
  engine TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_appraisals_user ON appraisals (user_id, created_at);

-- Suscripciones SIMULADAS (modo demo). No existe ningún campo para datos de tarjeta.
CREATE TABLE subscriptions (
  user_id INTEGER PRIMARY KEY,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','canceled')),
  started_at INTEGER NOT NULL,
  renews_at INTEGER,
  mock INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE mock_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  created_at INTEGER NOT NULL,
  note TEXT
);
