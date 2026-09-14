<?php
// Vortex v2 - Auth routes: register, login, phone OTP, me, logout.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/RateLimit.php';
require_once __DIR__ . '/Events.php';

function verify_password_maybe_upgrade(array $user, string $password): bool {
    $h = isset($user['pass_hash']) ? $user['pass_hash'] : null;
    if (!$h) return false;
    if (strpos($h, 'legacy:') === 0) {
        $parts = explode(':', $h);
        if (count($parts) !== 3) return false;
        if (!hash_equals($parts[2], hash('sha256', $parts[1] . ':' . $password))) return false;
        $new = password_hash($password, PASSWORD_DEFAULT);
        $st = db()->prepare("UPDATE users SET pass_hash = :h WHERE username = :u");
        $st->execute([':h' => $new, ':u' => $user['username']]);
        return true;
    }
    return password_verify($password, $h);
}

function handle_auth_routes(string $method, array $parts, array $body): bool {
    $pdo = db();
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';

    if ($method === 'POST' && $p0 === 'register' && $p1 === '') {
        $username = (string)(isset($body['username']) ? $body['username'] : '');
        $password = (string)(isset($body['password']) ? $body['password'] : '');
        if (!valid_username($username)) json_error(400, 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_');
        if (strlen($password) < 4) json_error(400, 'رمز حداقل ۴ کاراکتر');
        if (find_user($username)) json_error(409, 'این نام کاربری قبلا ثبت شده');
        $st = $pdo->prepare("INSERT INTO users (username, display_name, pass_hash, created_at)
            VALUES (:u, :d, :h, :c)");
        $st->execute([
            ':u' => $username, ':d' => $username,
            ':h' => password_hash($password, PASSWORD_DEFAULT), ':c' => time(),
        ]);
        ensure_bot_user();
        emit_users_changed();
        $token = create_session($username);
        json_out(200, ['ok' => true, 'token' => $token, 'me' => public_user(find_user($username))]);
    }

    if ($method === 'POST' && $p0 === 'login' && $p1 === '') {
        if (!rate_ok('login:' . client_ip(), 20, 60)) json_error(429, 'تلاش زیاد — یک دقیقه صبر کن');
        $username = (string)(isset($body['username']) ? $body['username'] : '');
        $password = (string)(isset($body['password']) ? $body['password'] : '');
        $user = find_user($username);
        if (!$user || !verify_password_maybe_upgrade($user, $password)) {
            json_error(401, 'نام کاربری یا رمز اشتباه است');
        }
        if (!empty($user['banned'])) json_error(403, 'حساب شما مسدود شده است');
        $token = create_session($user['username']);
        json_out(200, ['token' => $token, 'me' => public_user(find_user($user['username']))]);
    }

    if ($method === 'POST' && $p0 === 'send-code' && $p1 === '') {
        $phone = normalize_phone(isset($body['phone']) ? $body['phone'] : null);
        if (!$phone) json_error(400, 'شماره موبایل معتبر نیست (مثل 09123456789)');
        if (!rate_ok('send-code:' . $phone, 5, 300)) json_error(429, 'کد زیاد درخواست شده — چند دقیقه صبر کن');
        $code = issue_code($phone);
        // SMS provider hook: اگر SMS_API_URL ست شده باشد، همین‌جا ارسال می‌شود. در حالت dev کد برگردانده می‌شود.
        $out = ['ok' => true];
        if (envv('APP_DEBUG', '') === '1') $out['devCode'] = $code;
        json_out(200, $out);
    }

    if ($method === 'POST' && $p0 === 'verify-code' && $p1 === '') {
        $phone = normalize_phone(isset($body['phone']) ? $body['phone'] : null);
        $code = (string)(isset($body['code']) ? $body['code'] : '');
        if (!$phone) json_error(400, 'شماره نامعتبر');
        if (!rate_ok('verify-code:' . $phone, 10, 300)) json_error(429, 'تلاش زیاد — چند دقیقه صبر کن');
        $chk = verify_code($phone, $code);
        if (isset($chk['error'])) json_error(401, $chk['error']);
        $user = find_user_by_phone($phone);
        if ($user) {
            consume_code($phone);
            if (!empty($user['banned'])) json_error(403, 'حساب شما مسدود شده است');
            $token = create_session($user['username']);
            json_out(200, ['token' => $token, 'me' => public_user($user)]);
        }
        json_out(200, ['needsName' => true]);
    }

    if ($method === 'POST' && $p0 === 'complete-register' && $p1 === '') {
        $phone = normalize_phone(isset($body['phone']) ? $body['phone'] : null);
        $code = (string)(isset($body['code']) ? $body['code'] : '');
        $displayName = trim((string)(isset($body['displayName']) ? $body['displayName'] : ''));
        $username = trim((string)(isset($body['username']) ? $body['username'] : ''));
        if (!$phone) json_error(400, 'شماره نامعتبر');
        $chk = verify_code($phone, $code);
        if (isset($chk['error'])) json_error(401, $chk['error']);
        $existing = find_user_by_phone($phone);
        if ($existing) {
            consume_code($phone);
            if (!empty($existing['banned'])) json_error(403, 'حساب شما مسدود شده است');
            $token = create_session($existing['username']);
            json_out(200, ['token' => $token, 'me' => public_user($existing)]);
        }
        if (mb_strlen($displayName) < 2) json_error(400, 'نام نمایشی حداقل ۲ حرف');
        if ($username !== '') {
            if (!valid_username($username)) json_error(400, 'نام کاربری: ۳ تا ۲۰ حرف انگلیسی/عدد/_');
            if (find_user($username)) json_error(409, 'این نام کاربری قبلاً گرفته شده');
        } else {
            $username = 'u' . substr($phone, 1);
            while (find_user($username)) $username .= (string)random_int(0, 9);
        }
        $adminPhones = array_filter(array_map('trim', explode(',', envv('ADMIN_PHONES', ''))));
        $isAdmin = in_array($phone, $adminPhones, true) ? 1 : 0;
        $st = $pdo->prepare("INSERT INTO users (username, phone, display_name, is_admin, is_premium, bio, created_at)
            VALUES (:u, :p, :d, :a, :pr, :b, :c)");
        $st->execute([
            ':u' => $username, ':p' => $phone, ':d' => $displayName,
            ':a' => $isAdmin, ':pr' => $isAdmin,
            ':b' => $isAdmin ? 'ادمین سیستم' : '', ':c' => time(),
        ]);
        consume_code($phone);
        ensure_bot_user();
        emit_users_changed();
        $token = create_session($username);
        json_out(200, ['ok' => true, 'token' => $token, 'me' => public_user(find_user($username)),
            'message' => $isAdmin ? 'حساب ادمین ساخته شد' : 'حساب ساخته شد']);
    }

    if ($method === 'GET' && $p0 === 'me' && $p1 === '') {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        json_out(200, ['me' => public_user($me)]);
    }

    if ($method === 'POST' && $p0 === 'logout' && $p1 === '') {
        $t = bearer_token();
        if ($t) destroy_session($t);
        json_out(200, ['ok' => true]);
    }

    return false;
}
