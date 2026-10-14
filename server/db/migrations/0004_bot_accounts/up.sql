-- VORTEXGRAM — migration 0004_bot_accounts (up)
-- Bot accounts + the n8n posting pipeline.
--
--  1. users.is_bot        — a bot is a real `users` row (so it can own channels and
--                           appear in member lists) but can never log in.
--  2. bot_api_keys        — per-bot posting credentials. ONLY a keyed hash is stored
--                           (HMAC-SHA256 with a server-side pepper); the raw key is
--                           returned exactly once at creation/rotation.
--  3. message_source      — structured provenance for a post derived from external
--                           content: the visible source link + the optional AI label.
--                           Kept out of `content` so the UI can render it distinctly
--                           and so it is auditable/togglable.
--  4. message_post_meta   — per-post analytics: ai flag, view count and reaction
--                           totals. Views are stored as an aggregate count only —
--                           who viewed is never persisted or exposed.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users (is_bot) WHERE is_bot;

-- key_id is the lookup handle (public, random); key_hash is the peppered HMAC.
-- Two rows per bot are allowed at most (current + previous) to support rotation
-- with a short overlap window.
CREATE TABLE bot_api_keys (
  key_id       TEXT PRIMARY KEY,
  bot_username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT,                          -- first 8 chars, for admin display only
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at   BIGINT NOT NULL DEFAULT 0,
  rotated_at   BIGINT,
  revoked_at   BIGINT,
  last_used_at BIGINT,
  label        TEXT
);
CREATE INDEX idx_bot_keys_bot ON bot_api_keys (bot_username);
CREATE INDEX idx_bot_keys_active ON bot_api_keys (key_id) WHERE status = 'active';

CREATE TABLE message_source (
  message_id   TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,                 -- canonical, http(s)-only source link
  site         TEXT,                          -- display host, e.g. 'x.com'
  title        TEXT,                          -- optional headline / feed item title
  provider     TEXT                           -- e.g. 'rss', 'n8n', 'manual'
);

-- view_count is a monotonic aggregate: unique viewers per post, no identities.
CREATE TABLE message_post_meta (
  message_id   TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ai_label     TEXT,                          -- e.g. 'تولید شده با هوش مصنوعی'
  view_count   INTEGER NOT NULL DEFAULT 0,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  updated_at   BIGINT
);
CREATE INDEX idx_post_meta_ai ON message_post_meta (ai_generated) WHERE ai_generated;