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

// جایگزین‌های امن وقتی افزونه‌ی mbstring روی هاست نصب نیست — بدون mbstring هیچ route
// با خطای 500 نمی‌شکند (پردازش بایتی انجام می‌شود؛ محدودیت‌های طول کمی متفاوت می‌شوند).
if (!function_exists('mb_strlen')) {
    function mb_strlen(string $s): int {
        return strlen($s);
    }
}
if (!function_exists('mb_substr')) {
    function mb_substr(string $s, int $start, ?int $length = null, ?string $encoding = null): string {
        if ($length === null) return substr($s, $start);
        return substr($s, $start, $length);
    }
}
