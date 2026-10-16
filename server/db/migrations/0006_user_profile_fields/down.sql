-- VORTEXGRAM - migration 0006_user_profile_fields (down)
-- Removes the Slice A profile columns added in 0006_user_profile_fields.
ALTER TABLE users DROP COLUMN IF EXISTS birthday;
ALTER TABLE users DROP COLUMN IF EXISTS emoji_status;
