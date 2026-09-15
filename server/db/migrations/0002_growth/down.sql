-- VORTEXGRAM — migration 0002_growth (down)
-- Reversible: removes the columns and audit table added by 0002_growth.

ALTER TABLE users DROP COLUMN IF EXISTS devices;
ALTER TABLE users DROP COLUMN IF EXISTS last_login;
DROP TABLE IF EXISTS message_deletions;