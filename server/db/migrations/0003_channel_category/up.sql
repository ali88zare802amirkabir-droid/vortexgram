-- VORTEXGRAM — migration 0003_channel_category (up)
-- Persist the optional channel/group category used by Explore/Discover.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category TEXT;
