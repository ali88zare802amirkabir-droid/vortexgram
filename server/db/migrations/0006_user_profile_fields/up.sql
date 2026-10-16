-- VORTEXGRAM - migration 0006_user_profile_fields (up)
-- Slice A (Task T) profile fields:
--   * birthday    - 'YYYY-MM-DD' text (validated in the API) or empty.
--   * emoji_status - a short emoji sequence shown next to the display name.
-- Both are nullable with an empty-string default so existing rows and legacy
-- inserts (which pass NULL for absent text fields) keep working, and the client
-- falls back to '' when the value is NULL/absent (JSON backend parity).

ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS emoji_status TEXT DEFAULT '';
