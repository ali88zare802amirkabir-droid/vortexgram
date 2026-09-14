<?php
// Vortex v2 — Db: اتصال PDO به SQLite + ساخت خودکار اسکیما.
// همه‌ی کوئری‌های پروژه Prepared Statement هستند (دفاع در برابر SQL Injection).

require_once __DIR__ . '/Config.php';

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $dir = envv('STORAGE_DIR', __DIR__ . '/../storage');
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $file = rtrim($dir, '/\\') . '/app.sqlite';

    $pdo = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("PRAGMA journal_mode=WAL");
    $pdo->exec("PRAGMA busy_timeout=5000");
    $pdo->exec("PRAGMA foreign_keys=ON");
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        phone TEXT UNIQUE,
        display_name TEXT NOT NULL,
        pass_hash TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_premium INTEGER NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0,
        avatar TEXT,
        bio TEXT DEFAULT '',
        skin TEXT DEFAULT 'default',
        effect TEXT DEFAULT 'off',
        effect_color TEXT,
        bg TEXT,
        blocked_json TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        last_seen INTEGER DEFAULT 0
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS codes (
        phone TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS stream_tickets (
        ticket TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        from_user TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text',
        content TEXT DEFAULT '',
        url TEXT,
        mime TEXT,
        name TEXT,
        size INTEGER,
        duration REAL,
        wave_json TEXT,
        reply_json TEXT,
        album_json TEXT,
        poll_json TEXT,
        checklist_json TEXT,
        reactions_json TEXT DEFAULT '{}',
        fwd_from TEXT,
        time_ms INTEGER NOT NULL,
        edited INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, time_ms)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS read_state (
        room TEXT NOT NULL,
        username TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        PRIMARY KEY (room, username)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS chat_state (
        room TEXT NOT NULL,
        username TEXT NOT NULL,
        k TEXT NOT NULL,
        v INTEGER NOT NULL,
        PRIMARY KEY (room, username, k)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'group',
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        avatar TEXT,
        invite_token TEXT,
        created_at INTEGER NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS group_members (
        gid TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        PRIMARY KEY (gid, username)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pins (
        room TEXT NOT NULL,
        msg_id TEXT NOT NULL,
        PRIMARY KEY (room, msg_id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        time_ms INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    )");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_events_user ON events(username, id)");
    $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        k TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
    )");
}
