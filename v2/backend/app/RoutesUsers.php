<?php
// Vortex v2 - User routes: block, search, profiles, profile settings.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/RateLimit.php';

function my_blocked(array $me): array {
    $b = json_decode(isset($me['blocked_json']) ? $me['blocked_json'] : '[]', true);
    return is_array($b) ? array_values($b) : [];
}

function handle_user_routes(string $method, array $parts, array $body): bool {
    $pdo = db();
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';
    $me = current_user();
    if (!$me) json_error(401, 'احراز هویت نامعتبر');
    $meName = $me['username'];

    if ($method === 'POST' && ($p0 === 'block' || $p0 === 'unblock') && $p1 === '') {
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        if ($target === '' || $target === $meName || $target === 'vortex_bot') json_error(400, 'کاربر نامعتبر');
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        $b = my_blocked($me);
        if ($p0 === 'block') {
            if (!in_array($target, $b, true)) $b[] = $target;
        } else {
            $b = array_values(array_filter($b, function ($x) use ($target) { return $x !== $target; }));
        }
        $pdo->prepare("UPDATE users SET blocked_json = :b WHERE username = :u")
            ->execute([':b' => json_encode(array_values($b)), ':u' => $meName]);
        emit_event($target, 'peer-changed', ['username' => $meName], 300);
        json_out(200, ['ok' => true, 'blocked' => array_values($b)]);
    }

    if ($method === 'GET' && $p0 === 'blocked' && $p1 === '') {
        json_out(200, ['blocked' => my_blocked($me)]);
    }

    if ($method === 'GET' && $p0 === 'users' && $p1 === 'search') {
        $q = trim((string)(isset($_GET['q']) ? $_GET['q'] : ''));
        if (mb_strlen($q) < 2) json_out(200, ['users' => []]);
        $like = '%' . $q . '%';
        $st = $pdo->prepare("SELECT username, display_name, avatar FROM users
            WHERE banned = 0 AND (username LIKE :q OR display_name LIKE :q2) LIMIT 20");
        $st->execute([':q' => $like, ':q2' => $like]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[] = ['username' => $r['username'], 'displayName' => $r['display_name'], 'avatar' => $r['avatar']];
        }
        json_out(200, ['users' => $out]);
    }

    if ($method === 'GET' && $p0 === 'user' && $p1 !== '' && !isset($parts[2])) {
        $u = find_user($p1);
        if (!$u || !empty($u['banned'])) json_error(404, 'کاربر یافت نشد');
        $p = public_user($u);
        $p['online'] = (int)($u['last_seen'] ?? 0) >= time() - 90;
        if ($meName !== $u['username'] && empty($me['is_admin'])) unset($p['phone']);
        json_out(200, ['user' => $p]);
    }

    if ($method === 'GET' && $p0 === 'users' && $p1 === 'exists' && isset($parts[2])) {
        json_out(200, ['exists' => find_user($parts[2]) !== null]);
    }

    if ($method === 'POST' && $p0 === 'profile' && $p1 === 'bio') {
        $max = (!empty($me['is_premium']) || !empty($me['is_admin'])) ? 200 : 80;
        $bio = mb_substr(trim((string)(isset($body['bio']) ? $body['bio'] : '')), 0, $max);
        $pdo->prepare("UPDATE users SET bio = :b WHERE username = :u")->execute([':b' => $bio, ':u' => $meName]);
        emit_users_changed();
        json_out(200, ['ok' => true, 'bio' => $bio]);
    }

    if ($method === 'POST' && $p0 === 'rename' && $p1 === '') {
        if (!rate_ok('rename:' . $meName, 5, 3600)) json_error(429, 'بعداً تلاش کن');
        $name = trim((string)(isset($body['displayName']) ? $body['displayName'] : ''));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) json_error(400, 'نام نمایشی ۲ تا ۴۰ حرف');
        $pdo->prepare("UPDATE users SET display_name = :d WHERE username = :u")->execute([':d' => $name, ':u' => $meName]);
        emit_users_changed();
        json_out(200, ['ok' => true, 'displayName' => $name]);
    }

    if ($method === 'POST' && $p0 === 'profile' && ($p1 === 'avatar' || $p1 === 'background') && isset($parts[2]) && $parts[2] === 'url') {
        $url = trim((string)(isset($body['url']) ? $body['url'] : ''));
        if ($url !== '' && !preg_match('/^(\/img\/|\/uploads\/|https:\/\/)[\w.\-\/%?=&#+]+$/', $url)) json_error(400, 'آدرس نامعتبر');
        $url = mb_substr($url, 0, 300);
        $col = $p1 === 'avatar' ? 'avatar' : 'bg';
        $pdo->prepare("UPDATE users SET $col = :v WHERE username = :u")->execute([':v' => $url !== '' ? $url : null, ':u' => $meName]);
        emit_users_changed();
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p0 === 'skin' && $p1 === '') {
        $skin = mb_substr((string)(isset($body['skin']) ? $body['skin'] : 'default'), 0, 30);
        $pdo->prepare("UPDATE users SET skin = :v WHERE username = :u")->execute([':v' => $skin, ':u' => $meName]);
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p0 === 'profile-effect' && $p1 === '') {
        $eff = mb_substr((string)(isset($body['effect']) ? $body['effect'] : 'off'), 0, 20);
        $color = isset($body['color']) ? mb_substr((string)$body['color'], 0, 20) : null;
        $pdo->prepare("UPDATE users SET effect = :e, effect_color = :c WHERE username = :u")
            ->execute([':e' => $eff, ':c' => $color, ':u' => $meName]);
        json_out(200, ['ok' => true]);
    }

    return false;
}
