<?php
// Vortex v2 — Config: خواندن تنظیمات از Environment (Render/Vercel) با مقدار پیش‌فرض امن.

function envv(string $key, string $default = ''): string {
    $v = getenv($key);
    if ($v === false) $v = $_SERVER[$key] ?? $_ENV[$key] ?? null;
    if ($v === false || $v === null) return $default;
    return trim((string)$v);
}

function is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    return false;
}
