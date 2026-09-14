<?php
// Vortex v2 — Util: پاسخ JSON، خواندن بدنه، اعتبارسنجی، هدرهای امنیتی، CORS.

require_once __DIR__ . '/Config.php';

function now_ms(): int {
    return (int) round(microtime(true) * 1000);
}

function new_uuid(): string {
    return bin2hex(random_bytes(16));
}

function new_token(int $bytes = 32): string {
    return bin2hex(random_bytes($bytes));
}

function security_headers(): void {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if (is_https()) header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

function handle_cors(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = array_filter(array_map('trim', explode(',', envv('FRONTEND_ORIGIN', ''))));
    if ($origin !== '' && in_array($origin, $allowed, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Max-Age: 600');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function json_out(int $code, array $data): void {
    security_headers();
    handle_cors();
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(int $code, string $msg): void {
    json_out($code, ['error' => $msg]);
}

/** خواندن بدنه‌ی JSON با سقف ۱ مگابایت (دفاع در برابر body-bomb). */
function read_json(int $maxBytes = 1048576): array {
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || $raw === '') return [];
    if (strlen($raw) > $maxBytes) json_error(413, 'بدنه‌ی درخواست بیش از حد بزرگ است');
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function bearer_token(): ?string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) {
        $all = getallheaders();
        foreach ($all as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    if (stripos($h, 'Bearer ') === 0) {
        $t = trim(substr($h, 7));
        return $t !== '' ? $t : null;
    }
    return null;
}

function valid_username(string $u): bool {
    return (bool) preg_match('/^[a-zA-Z0-9_]{3,20}$/', $u);
}

/** نرمال‌سازی شماره‌ی ایرانی + تبدیل ارقام فارسی/عربی. برمی‌گرداند null اگر نامعتبر. */
function normalize_phone($p): ?string {
    $p = (string)($p ?? '');
    $fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    $ar = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    $p = str_replace($fa, ['0','1','2','3','4','5','6','7','8','9'], $p);
    $p = str_replace($ar, ['0','1','2','3','4','5','6','7','8','9'], $p);
    $p = preg_replace('/[\s\-()]/', '', $p);
    if (strpos($p, '+98') === 0) $p = '0' . substr($p, 3);
    elseif (strpos($p, '98') === 0 && strlen($p) === 12) $p = '0' . substr($p, 2);
    if (!preg_match('/^09\d{9}$/', $p)) return null;
    return $p;
}

function client_ip(): string {
    $f = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($f !== '') {
        $first = trim(explode(',', $f)[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) return $first;
    }
    return $_SERVER['REMOTE_ADDR'] ?? '?';
}
