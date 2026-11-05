-- Users (registered application accounts)
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  email_normalized TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_users_email_normalized ON users(email_normalized);

-- Guest identities (server-side guest tokens)
CREATE TABLE guests (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  migrated_to_user_id TEXT REFERENCES users(id)
);

CREATE INDEX idx_guests_token_hash ON guests(token_hash);

-- App sessions (registered users)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);

-- Email verification tokens (store hash only)
CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_verify_user ON email_verification_tokens(user_id);

-- Password reset tokens (store hash only)
CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);

-- Trips
CREATE TABLE trips (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'guest')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  owner_guest_id TEXT REFERENCES guests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  destination TEXT,
  start_date TEXT,
  end_date TEXT,
  duration_days INTEGER,
  travelers_adults INTEGER DEFAULT 1,
  travelers_children INTEGER DEFAULT 0,
  children_ages TEXT, -- JSON array
  budget_amount REAL,
  budget_currency TEXT DEFAULT 'USD',
  interests TEXT, -- JSON array
  travel_pace TEXT,
  special_requirements TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  itinerary_json TEXT, -- structured itinerary
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_trips_user ON trips(owner_user_id);
CREATE INDEX idx_trips_guest ON trips(owner_guest_id);
CREATE INDEX idx_trips_created ON trips(created_at DESC);

-- Conversation messages per trip
CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_messages_trip ON messages(trip_id, created_at);

-- Administrators (separate identity)
CREATE TABLE administrators (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  is_bootstrap INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Admin sessions
CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  admin_id TEXT NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_admin_sessions_token ON admin_sessions(token_hash);

-- API usage records (request-level)
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_or_endpoint TEXT,
  operation_type TEXT NOT NULL,
  owner_type TEXT CHECK (owner_type IN ('user', 'guest', 'system', 'unattributed')),
  owner_user_id TEXT,
  owner_guest_id TEXT,
  trip_id TEXT,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  billable_units REAL,
  estimated_cost REAL,
  currency TEXT DEFAULT 'USD',
  pricing_version TEXT,
  duration_ms INTEGER,
  error_info TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_usage_timestamp ON usage_records(timestamp DESC);
CREATE INDEX idx_usage_user ON usage_records(owner_user_id);
CREATE INDEX idx_usage_guest ON usage_records(owner_guest_id);
CREATE INDEX idx_usage_trip ON usage_records(trip_id);
CREATE INDEX idx_usage_provider ON usage_records(provider);

-- Pricing reference snapshots
CREATE TABLE pricing_refs (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  model_or_sku TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  unit_cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  version TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  notes TEXT
);

-- Administrative audit log (append-only)
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  admin_id TEXT,
  admin_username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  details_json TEXT,
  ip_hint TEXT
);

CREATE INDEX idx_audit_timestamp ON admin_audit_log(timestamp DESC);

-- App error / ops events (lightweight)
CREATE TABLE ops_events (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  trip_id TEXT,
  owner_user_id TEXT,
  owner_guest_id TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_ops_timestamp ON ops_events(timestamp DESC);

-- Bootstrap state (prevent recreating deleted bootstrap admin)
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
