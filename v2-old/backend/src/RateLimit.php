<?php
// Vortex v2 — RateLimit: محدودکننده‌ی نرخ پنجره‌ی ثابت روی SQLite (ضد بروت‌فورس/اسپم).

require_once __DIR__ . '/Db.php';

function rate_ok(string $key, int $max, int $windowSec): bool {
    $pdo = db();
    $now = time();
    $row = null;
    try {
        $st = $pdo->prepare("SELECT window_start, count FROM rate_limits WHERE k = :k");
        $st->execute([':k' => $key]);
        $row = $st->fetch();
    } catch (Throwable $e) { return true; }

    if (!$row || (int)$row['window_start'] + $windowSec <= $now) {
        $st = $pdo->prepare("INSERT INTO rate_limits (k, window_start, count) VALUES (:k, :w, 1)
            ON CONFLICT(k) DO UPDATE SET window_start = :w2, count = 1");
        $st->execute([':k' => $key, ':w' => $now, ':w2' => $now]);
        return true;
    }
    if ((int)$row['count'] >= $max) return false;
    $st = $pdo->prepare("UPDATE rate_limits SET count = count + 1 WHERE k = :k");
    $st->execute([':k' => $key]);
    return true;
}
