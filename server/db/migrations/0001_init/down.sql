-- VORTEXGRAM — migration 0001_init (down)
-- Reversible: drops every table created by 0001_init, in reverse FK order.
-- CASCADE guards against a later migration adding a dependent table and
-- forgetting to drop it here (0004 adds message_source / message_post_meta).

DROP TABLE IF EXISTS notifications CASCADE;      -- references users, messages
DROP TABLE IF EXISTS message_reads CASCADE;      -- references users, messages
DROP TABLE IF EXISTS message_reactions CASCADE;  -- references users, messages
DROP TABLE IF EXISTS attachments CASCADE;        -- references messages
DROP TABLE IF EXISTS messages CASCADE;           -- references users, conversations, self
DROP TABLE IF EXISTS conversation_members CASCADE;
DROP TABLE IF EXISTS read_state CASCADE;
DROP TABLE IF EXISTS chat_state CASCADE;
DROP TABLE IF EXISTS pinned CASCADE;
DROP TABLE IF EXISTS scheduled CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;      -- references users
DROP TABLE IF EXISTS rename_requests CASCADE;    -- references users
DROP TABLE IF EXISTS sessions CASCADE;           -- references users
DROP TABLE IF EXISTS kv CASCADE;
DROP TABLE IF EXISTS users CASCADE;