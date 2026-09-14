<?php
// Vortex v2 - Admin routes. Sensitive ops require the ORIGINAL admin (ADMIN_PHONES).

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Events.php';

function require_admin(bool $original = false): array {
    $me = current_user();
    if (!$me || empty($me['is_admin'])) json_error(403, 'فقط ادمین');
    if ($original && !is_original_admin($me)) json_error(403, 'فقط ادمین اصلی');
    return $me;
}

function handle_admin_routes(string $method, array $parts, array $body): bool {
    $pdo = db();
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';
    $p2 = isset($parts[2]) ? $parts[2] : '';
    if ($p0 !== 'admin') return false;

    if ($method === 'GET' && $p1 === 'stats' && $p2 === '') {
        require_admin(false);
        $online = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE last_seen >= " . (time() - 90))->fetchColumn();
        json_out(200, [
            'users' => (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn(),
            'messages' => (int)$pdo->query("SELECT COUNT(*) FROM messages")->fetchColumn(),
            'groups' => (int)$pdo->query("SELECT COUNT(*) FROM groups")->fetchColumn(),
            'online' => $online,
        ]);
    }

    if ($method === 'GET' && $p1 === 'users' && $p2 === '') {
        $me = require_admin(false);
        $rows = $pdo->query("SELECT * FROM users ORDER BY created_at DESC LIMIT 500")->fetchAll();
        $out = [];
        foreach ($rows as $u) {
            $p = public_user($u);
            $p['online'] = (int)($u['last_seen'] ?? 0) >= time() - 90;
            if (!is_original_admin($me)) unset($p['phone']);
            $out[] = $p;
        }
        json_out(200, ['users' => $out]);
    }

    if ($method === 'POST' && $p1 === 'ban' && $p2 === '') {
        require_admin(true);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        if (!empty($u['is_admin'])) json_error(400, 'ادمین را نمی‌شود مسدود کرد');
        $banned = !empty($body['banned']) ? 1 : 0;
        $pdo->prepare("UPDATE users SET banned = :b WHERE username = :u")->execute([':b' => $banned, ':u' => $target]);
        $pdo->prepare("DELETE FROM sessions WHERE username = :u")->execute([':u' => $target]);
        if ($banned) emit_event($target, 'kicked', [], 300);
        emit_users_changed();
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p1 === 'promote' && $p2 === '') {
        require_admin(true);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        $v = !empty($body['isAdmin']) ? 1 : 0;
        $pdo->prepare("UPDATE users SET is_admin = :v WHERE username = :u")->execute([':v' => $v, ':u' => $target]);
        emit_users_changed();
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p1 === 'impersonate' && $p2 === '') {
        require_admin(true);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $u = find_user($target);
        if (!$u || !empty($u['banned'])) json_error(404, 'کاربر یافت نشد');
        $token = create_session($u['username']);
        json_out(200, ['ok' => true, 'token' => $token, 'me' => public_user($u)]);
    }

    if ($method === 'POST' && $p1 === 'reset-password' && $p2 === '') {
        require_admin(true);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $pw = (string)(isset($body['newPassword']) ? $body['newPassword'] : '');
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        if (strlen($pw) < 4) json_error(400, 'رمز حداقل ۴ کاراکتر');
        $pdo->prepare("UPDATE users SET pass_hash = :h WHERE username = :u")
            ->execute([':h' => password_hash($pw, PASSWORD_DEFAULT), ':u' => $target]);
        $pdo->prepare("DELETE FROM sessions WHERE username = :u")->execute([':u' => $target]);
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p1 === 'premium' && $p2 === '') {
        require_admin(false);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        $v = !empty($body['isPremium']) ? 1 : 0;
        $pdo->prepare("UPDATE users SET is_premium = :v WHERE username = :u")->execute([':v' => $v, ':u' => $target]);
        emit_users_changed();
        json_out(200, ['ok' => true]);
    }

    if ($method === 'POST' && $p1 === 'displayname' && $p2 === '') {
        require_admin(true);
        $target = (string)(isset($body['username']) ? $body['username'] : '');
        $name = trim((string)(isset($body['displayName']) ? $body['displayName'] : ''));
        $u = find_user($target);
        if (!$u) json_error(404, 'کاربر یافت نشد');
        if (mb_strlen($name) < 2 || mb_strlen($name) > 40) json_error(400, 'نام نمایشی ۲ تا ۴۰ حرف');
        $pdo->prepare("UPDATE users SET display_name = :d WHERE username = :u")->execute([':d' => $name, ':u' => $target]);
        emit_users_changed();
        json_out(200, ['ok' => true]);
    }

    if ($method === 'GET' && $p1 === 'user' && $p2 !== '' && isset($parts[3]) && $parts[3] === 'rooms') {
        require_admin(false);
        $target = $p2;
        $rooms = [];
        $st = $pdo->query("SELECT DISTINCT room FROM messages");
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $room) {
            if (strpos($room, 'dm:') === 0) {
                $ps = explode('|', substr($room, 3));
                if (in_array($target, $ps, true)) $rooms[] = $room;
            }
        }
        $st = $pdo->prepare("SELECT gid FROM group_members WHERE username = :u");
        $st->execute([':u' => $target]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $gid) $rooms[] = 'group:' . $gid;
        json_out(200, ['rooms' => array_values(array_unique($rooms))]);
    }

    if ($method === 'GET' && $p1 === 'room' && $p2 === 'messages') {
        require_admin(false);
        $room = substr((string)(isset($_GET['room']) ? $_GET['room'] : ''), 0, 100);
        $limit = min(100, max(1, (int)(isset($_GET['limit']) ? $_GET['limit'] : 50)));
        $st = $pdo->prepare("SELECT * FROM messages WHERE room = :r AND deleted = 0 ORDER BY time_ms DESC LIMIT " . $limit);
        $st->execute([':r' => $room]);
        $out = [];
        foreach (array_reverse($st->fetchAll()) as $r) $out[] = enrich_msg($r);
        json_out(200, ['roomId' => $room, 'messages' => $out]);
    }

    return false;
}
