-- VORTEXGRAM — migration 0001_init (up)
-- Normalized relational schema. The in-memory `db` object stays the single
-- source of truth at runtime; save()/load() map it 1:1 onto these tables inside
-- one transaction. `time`-style columns are BIGINT epoch-ms (the app's own
-- timestamps). `message_reads` and `notifications` are the spec's
-- forward-compatible core tables (reserved for granular read receipts/pushes);
-- everything else is actively used by the runtime.

CREATE TABLE users (
  username             TEXT PRIMARY KEY,
  phone                TEXT,
  display_name         TEXT NOT NULL DEFAULT '',
  avatar               TEXT,
  salt                 TEXT,
  pass_hash            TEXT,
  bio                  TEXT,
  is_admin             BOOLEAN NOT NULL DEFAULT FALSE,
  is_premium           BOOLEAN NOT NULL DEFAULT FALSE,
  banned               BOOLEAN NOT NULL DEFAULT FALSE,
  active_skin          TEXT,
  profile_effect       TEXT,
  profile_effect_color TEXT,
  profile_bg           TEXT,
  blocked              TEXT[] NOT NULL DEFAULT '{}',
  created_at           BIGINT,
  last_seen            BIGINT,
  updated_at           BIGINT
);

CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- conversations.id is the runtime roomId ('dm:a|b' | 'group:<hex>').
CREATE TABLE conversations (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('dm', 'group', 'channel')),
  title        TEXT,                        -- group/channel display name (NULL for dm)
  avatar       TEXT,
  owner        TEXT REFERENCES users(username) ON DELETE SET NULL,
  invite_token TEXT,
  created_at   BIGINT,
  updated_at   BIGINT
);
CREATE INDEX idx_conversations_type ON conversations (type);
CREATE UNIQUE INDEX idx_conversations_invite ON conversations (invite_token) WHERE invite_token IS NOT NULL;

CREATE TABLE conversation_members (
  conversation_id      TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  role                 TEXT CHECK (role IN ('owner', 'admin', 'member')),
  joined_at            BIGINT,
  last_read_message_id TEXT,                -- denormalized marker; no FK (avoids a circular reference)
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_members_user ON conversation_members (user_id);

CREATE TABLE messages (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id           TEXT REFERENCES users(username) ON DELETE SET NULL,   -- NULL for bot/legacy senders; `from` keeps the handle
  "from"              TEXT NOT NULL,                                        -- original sender snapshot (e.g. 'vortex_bot')
  from_name           TEXT,
  from_avatar         TEXT,
  from_premium        BOOLEAN NOT NULL DEFAULT FALSE,
  kind                TEXT NOT NULL DEFAULT 'text'
                      CHECK (kind IN ('text','sticker','image','gif','video','audio','voice','file','poll','checklist','album')),
  content             TEXT NOT NULL DEFAULT '',
  silent              BOOLEAN NOT NULL DEFAULT FALSE,
  fwd_from            TEXT,
  edited              BOOLEAN NOT NULL DEFAULT FALSE,
  reply_to_id         TEXT,                                                 -- raw quoted message id (survives pruning)
  reply_to_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,      -- relational pointer when target still exists
  reply_to_name       TEXT,                                                 -- display snapshot of the quoted message
  reply_to_snippet    TEXT,
  poll                JSONB,                                                -- poll message payload (question/options/votes), treated atomically by the app
  checklist           JSONB,                                                -- checklist message payload (title/items), treated atomically by the app
  album               TEXT[],                                               -- ordered file urls for 'album' messages
  time                BIGINT NOT NULL,
  updated_at          BIGINT,
  deleted_at          BIGINT
);
CREATE INDEX idx_messages_room_time ON messages (conversation_id, time);
CREATE INDEX idx_messages_sender ON messages (sender_id);
CREATE INDEX idx_messages_reply ON messages (reply_to_message_id);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'file',
  url        TEXT NOT NULL,
  filename   TEXT,
  size       BIGINT,
  mime_type  TEXT,
  duration   DOUBLE PRECISION,
  wave       DOUBLE PRECISION[],            -- voice waveform magnitudes
  sort       INTEGER NOT NULL DEFAULT 0,    -- ordering inside an album message
  created_at BIGINT
);
CREATE INDEX idx_attachments_message ON attachments (message_id);

CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,                 -- app enforces the emoji whitelist at the API layer (legacy data may differ)
  created_at BIGINT,
  updated_at BIGINT,
  PRIMARY KEY (message_id, user_id)         -- at most one reaction per user per message
);
CREATE INDEX idx_reactions_user ON message_reactions (user_id);

CREATE TABLE message_reads (                 -- spec core table; reserved for granular per-message read receipts
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  read_at    BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE notifications (                 -- spec core table; reserved for push/notification delivery
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'message',
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  content    TEXT,
  read_at    BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at);

CREATE TABLE read_state (                    -- runtime readState: per-conversation last-read timestamp per user
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  ts              BIGINT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_read_state_user ON read_state (user_id);

CREATE TABLE chat_state (                    -- runtime chatState: dynamic per-user/per-room flags
  username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  room_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  data     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- dynamic flags (archived/pinned/muted/hidden/locked/...)
  PRIMARY KEY (username, room_id)
);
CREATE INDEX idx_chat_state_room ON chat_state (room_id);

CREATE TABLE pinned (
  room_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  msg_id  TEXT NOT NULL,
  ts      BIGINT NOT NULL DEFAULT 0,         -- preserves pin order
  PRIMARY KEY (room_id, msg_id)
);
CREATE INDEX idx_pinned_msg ON pinned (msg_id);

CREATE TABLE scheduled (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  from_user       TEXT,
  kind            TEXT NOT NULL DEFAULT 'text'
                  CHECK (kind IN ('text','sticker','image','gif','video','audio','voice','file','poll','checklist','album')),
  content         TEXT NOT NULL DEFAULT '',
  url             TEXT,
  name            TEXT,
  mime_type       TEXT,
  poll            JSONB,
  checklist       JSONB,
  scheduled_for   BIGINT NOT NULL,
  created_at      BIGINT
);
CREATE INDEX idx_scheduled_at ON scheduled (scheduled_for);
CREATE INDEX idx_scheduled_room ON scheduled (conversation_id);

CREATE TABLE rename_requests (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  old_name     TEXT NOT NULL DEFAULT '',
  new_name     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  requested_at BIGINT
);
CREATE INDEX idx_rename_status ON rename_requests (status);

CREATE TABLE sessions (                      -- existing auth architecture (token -> user)
  token      TEXT PRIMARY KEY,
  username   TEXT REFERENCES users(username) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT
);

CREATE TABLE kv (                            -- non-modeled top-level runtime keys + internal bookkeeping
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);