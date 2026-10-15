-- VORTEXGRAM - migration 0005_user_settings (down)
-- Drops the per-user settings document added in 0005_user_settings.
ALTER TABLE users DROP COLUMN IF EXISTS settings;
