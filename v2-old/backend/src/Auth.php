<?php
// Vortex v2 — Auth: ثبت‌نام/ورود، OTP موبایل، نشست‌ها، نقش ادمین.
// رمزها با password_hash (bcrypt/argon2) ذخیره می‌شن؛ توکن‌ها فقط به‌صورت هش نگه‌داری می‌شن.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';

const SESSION_TTL = 30 * 24 * 60 * 60;

function find_user(string $username): ?array {
    $st = db()->prepare("SELECT * FROM users WHERE lower(username) = lower(:u) LIMIT 1");
    $st->execute([':u' => $username]);
    $r = $st->fetch();
    return $r ?: null;
}

function find_user_by_phone(string $phone): ?array {
    $st = db()->prepare("SELECT * FROM users WHERE phone = :p LIMIT 1");
    $st->execute([':p' => $phone]);
    $r = $st->fetch();
    return $r ?: null;
}

function public_user(array $u): array {
    $blocked = [];
    if (!empty($u['blocked_json'])) {
        $b = json_decode($u['blocked_json'], true);
        if (is_array($b)) $blocked = array_values(array_filter($b, 'is_string'));
    }
    return [
        'username' => $u['username'],
        'displayName' => $u['display_name'] ?? $u['username'],
        'isAdmin' => (bool)($u['is_admin'] ?? 0),
        'isPremium' => (bool)($u['is_premium'] ?? 0),
        'banned' => (bool)($u['banned'] ?? 0),
        'avatar' => $u['avatar'] ?? null,
        'bio' => $u['bio'] ?? '',
        'phone' => $u['phone'] ?? null,
        'activeSkin' => $u['skin'] ?? 'default',
        'profileEffect' => $u['effect'] ?? 'off',
        'profileEffectColor' => $u['effect_color'] ?? null,
        'profileBg' => $u['bg'] ?? null,
        'blocked' => $blocked,
    ];
}

function is_original_admin(array $user): bool {
    if (empty($user['is_admin'])) return false;
    $phones = array_filter(array_map('trim', explode(',', envv('ADMIN_PHONES', ''))));
    return !empty($user['phone']) && in_array($user['phone'], $phones, true);
}

function create_session(string $username): string {
    $token = new_token(32);
    $st = db()->prepare("INSERT INTO sessions (token_hash, username, expires_at, created_at)
        VALUES (:h, :u, :e, :c)");
    $st->execute([
        ':h' => hash('sha256', $token),
        ':u' => $username,
        ':e' => time() + SESSION_TTL,
        ':c' => time(),
    ]);
    return $token;
}

function destroy_session(string $token): void {
    $st = db()->prepare("DELETE FROM sessions WHERE token_hash = :h");
    $st->execute([':h' => hash('sha256', $token)]);
}

/** کاربر جاری از روی هدر Bearer. null یعنی احراز نشده/مسدود/منقضی. */
function current_user(): ?array {
    $t = bearer_token();
    if ($t === null) return null;
    $pdo = db();
    $st = $pdo->prepare("SELECT u.* FROM sessions s JOIN users u ON u.username = s.username
        WHERE s.token_hash = :h LIMIT 1");
    $st->execute([':h' => hash('sha256', $t)]);
    $u = $st->fetch();
    if (!$u) return null;
    $st2 = $pdo->prepare("SELECT expires_at FROM sessions WHERE token_hash = :h");
    $st2->execute([':h' => hash('sha256', $t)]);
    $exp = (int)($st2->fetchColumn() ?: 0);
    if ($exp < time() || !empty($u['banned'])) {
        destroy_session($t);
        return null;
    }
    if ((int)($u['last_seen'] ?? 0) < time() - 60) {
        $up = $pdo->prepare("UPDATE users SET last_seen = :t WHERE username = :u");
        $up->execute([':t' => time(), ':u' => $u['username']]);
    }
    return $u;
}

/** صدور کد ۶ رقمی (۲ دقیقه اعتبار، حداکثر ۵ تلاش). */
function issue_code(string $phone): string {
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $st = db()->prepare("INSERT INTO codes (phone, code_hash, expires_at, attempts)
        VALUES (:p, :h, :e, 0)
        ON CONFLICT(phone) DO UPDATE SET code_hash = :h2, expires_at = :e2, attempts = 0");
    $st->execute([
        ':p' => $phone, ':h' => hash('sha256', $code), ':e' => time() + 120,
        ':h2' => hash('sha256', $code), ':e2' => time() + 120,
    ]);
    return $code;
}

/** بررسی کد. خروجی: ['ok'=>true] یا ['error'=>message] */
function verify_code(string $phone, string $code): array {
    $pdo = db();
    $st = $pdo->prepare("SELECT * FROM codes WHERE phone = :p LIMIT 1");
    $st->execute([':p' => $phone]);
    $rec = $st->fetch();
    if (!$rec || (int)$rec['expires_at'] < time()) return ['error' => 'کد نامعتبر یا منقضی شده'];
    if ((int)$rec['attempts'] >= 5) {
        $pdo->prepare("DELETE FROM codes WHERE phone = :p")->execute([':p' => $phone]);
        return ['error' => 'تعداد تلاش زیاد — کد جدید بگیر'];
    }
    if (!hash_equals($rec['code_hash'], hash('sha256', trim($code)))) {
        $pdo->prepare("UPDATE codes SET attempts = attempts + 1 WHERE phone = :p")->execute([':p' => $phone]);
        return ['error' => 'کد اشتباه است'];
    }
    return ['ok' => true];
}

function consume_code(string $phone): void {
    db()->prepare("DELETE FROM codes WHERE phone = :p")->execute([':p' => $phone]);
}

/** ساخت کاربر ربات (برای DM با Vortex AI). */
function ensure_bot_user(): void {
    if (find_user('vortex_bot')) return;
    $st = db()->prepare("INSERT INTO users (username, display_name, pass_hash, is_admin, is_premium, bio, created_at)
        VALUES ('vortex_bot', 'Vortex AI', NULL, 0, 0, 'دستیار هوشمند ورتکس', :c)");
    $st->execute([':c' => time()]);
}
