-- VORTEXGRAM — migration 0001_init (down)
-- Reversible: drops every table created by 0001_init, in reverse FK order.

DROP TABLE IF EXISTS notifications;      -- references users, messages
DROP TABLE IF EXISTS message_reads;      -- references users, messages
DROP TABLE IF EXISTS message_reactions;  -- references users, messages
DROP TABLE IF EXISTS attachments;        -- references messages
DROP TABLE IF EXISTS messages;           -- references users, conversations, self
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS read_state;
DROP TABLE IF EXISTS chat_state;
DROP TABLE IF EXISTS pinned;
DROP TABLE IF EXISTS scheduled;
DROP TABLE IF EXISTS conversations;      -- references users
DROP TABLE IF EXISTS rename_requests;    -- references users
DROP TABLE IF EXISTS sessions;           -- references users
DROP TABLE IF EXISTS kv;
DROP TABLE IF EXISTS users;