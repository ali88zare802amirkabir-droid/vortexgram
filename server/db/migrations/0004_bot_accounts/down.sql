-- VORTEXGRAM — migration 0004_bot_accounts (down)
-- هر دو جدولِ ساختاریافتهٔ پیام باید قبل از ریپلیس‌شدن 0001 حذف شوند؛
-- message_source و message_post_meta به messages(id) ارجاع دارند و
-- DROP TABLE messages در down.sql شمارهٔ 0001 بدون آن‌ها شکست می‌خورد.
DROP INDEX IF EXISTS idx_post_meta_ai;
DROP TABLE IF EXISTS message_post_meta;
DROP TABLE IF EXISTS message_source;
DROP INDEX IF EXISTS idx_bot_keys_active;
DROP INDEX IF EXISTS idx_bot_keys_bot;
DROP TABLE IF EXISTS bot_api_keys;
DROP INDEX IF EXISTS idx_users_is_bot;
ALTER TABLE users DROP COLUMN IF EXISTS is_bot;