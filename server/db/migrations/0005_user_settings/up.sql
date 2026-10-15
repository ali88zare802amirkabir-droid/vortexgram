-- VORTEXGRAM - migration 0005_user_settings (up)
-- Per-user settings stored as a single JSONB document on the users row.
--
-- The runtime keeps user.settings as a SPARSE object: it only contains the
-- paths the user has explicitly changed (e.g. {"privacy":{"lastSeen":"nobody"}}).
-- Defaults are applied in the read view (see SETTINGS_DEFAULTS in server.js) and
-- are never persisted, so an account that never opened settings round-trips
-- with an empty document and the runtime key set stays unchanged.
--
-- Values are validated by a whitelist before they are merged here, so this
-- column is always server-sanitized: no free-form keys, no oversized strings.

ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
