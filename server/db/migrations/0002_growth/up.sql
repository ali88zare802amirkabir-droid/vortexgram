-- VORTEXGRAM — migration 0002_growth (up)
-- Complete persistence for future needs:
--   1. users.devices            -> JSONB list of {ip, region, device, lastLogin}
--                                   (device-login history shown in the profile UI).
--   2. users.last_login         -> epoch-ms of the most recent login/connect.
--   3. message_deletions        -> audit log: an exact copy of every removed
--                                   message + who deleted it and when. The app
--                                   hard-removes messages at runtime; this keeps
--                                   a permanent record for later review/recovery.

ALTER TABLE users ADD COLUMN IF NOT EXISTS devices JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login BIGINT;

CREATE TABLE IF NOT EXISTS message_deletions (
  id         TEXT PRIMARY KEY,
  room_id    TEXT,
  msg_json   JSONB NOT NULL,               -- exact runtime copy of the deleted message
  deleted_by TEXT,
  deleted_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_deletions_room ON message_deletions (room_id);
CREATE INDEX IF NOT EXISTS idx_msg_deletions_at ON message_deletions (deleted_at);