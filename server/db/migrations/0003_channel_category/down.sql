-- VORTEXGRAM — migration 0003_channel_category (down)
-- Reversible: removes the category column added by 0003_channel_category.

ALTER TABLE conversations DROP COLUMN IF EXISTS category;
