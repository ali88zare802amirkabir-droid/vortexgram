<?php
// Vortex v2 - Events: outbox table for SSE delivery.
// Every mutation inserts one row per interested user; the stream delivers and deletes them.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Util.php';

function emit_event(string $username, string $type, array $payload = [], int $ttlSec = 86400): void {
    $st = db()->prepare("INSERT INTO events (username, type, payload_json, time_ms, expires_at)
        VALUES (:u, :t, :p, :m, :e)");
    $st->execute([
        ':u' => $username,
        ':t' => $type,
        ':p' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ':m' => now_ms(),
        ':e' => time() + $ttlSec,
    ]);
}

function emit_room(string $room, string $type, array $payload = [], ?string $except = null, int $ttlSec = 86400): void {
    foreach (room_users($room) as $u) {
        if ($except !== null && $u === $except) continue;
        if (!can_access($room, $u)) continue;
        emit_event($u, $type, $payload, $ttlSec);
    }
}

/** Notify all admins that the user list changed (replaces WS pushUsers). */
function emit_users_changed(): void {
    $st = db()->query("SELECT username FROM users WHERE is_admin = 1 AND banned = 0");
    $admins = $st->fetchAll(PDO::FETCH_COLUMN);
    foreach ($admins as $admin) {
        emit_event($admin, 'users-changed', [], 300);
    }
}

function emit_groups_changed(string $room): void {
    foreach (room_users($room) as $u) {
        emit_event($u, 'groups-changed', [], 300);
    }
}

/** Fetch fresh events + delete delivered and expired rows. */
function fetch_events(string $username, int $lastId, int $limit = 50): array {
    $pdo = db();
    $st = $pdo->prepare("SELECT * FROM events WHERE username = :u AND id > :last AND expires_at > :now
        ORDER BY id ASC LIMIT " . (int)$limit);
    $st->execute([':u' => $username, ':last' => $lastId, ':now' => time()]);
    $rows = $st->fetchAll();
    if ($rows) {
        $last = end($rows);
        $max = (int)$last['id'];
        $del = $pdo->prepare("DELETE FROM events WHERE username = :u AND id <= :m");
        $del->execute([':u' => $username, ':m' => $max]);
    }
    $pdo->prepare("DELETE FROM events WHERE expires_at <= :now")->execute([':now' => time()]);
    $out = [];
    foreach ($rows as $r) {
        $p = json_decode($r['payload_json'], true);
        $out[] = ['id' => (int)$r['id'], 'type' => $r['type'], 'data' => is_array($p) ? $p : []];
    }
    return $out;
}
