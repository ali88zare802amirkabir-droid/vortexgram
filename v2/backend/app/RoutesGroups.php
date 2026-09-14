<?php
// Vortex v2 - Group & channel routes.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Events.php';

function public_group(array $g, string $username): array {
    $pdo = db();
    $c = $pdo->prepare("SELECT COUNT(*) FROM group_members WHERE gid = :g");
    $c->execute([':g' => $g['id']]);
    $m = member_of($g['id'], $username);
    return [
        'id' => $g['id'], 'type' => $g['type'], 'name' => $g['name'], 'owner' => $g['owner'],
        'members' => (int)$c->fetchColumn(), 'joined' => true,
        'myRole' => $m ? $m['role'] : null,
    ];
}

function handle_group_routes(string $method, array $parts, array $body): bool {
    $pdo = db();
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';
    $p2 = isset($parts[2]) ? $parts[2] : '';

    // POST /api/groups/join/:token  (public shape, auth required)
    if ($method === 'POST' && $p0 === 'groups' && $p1 === 'join' && $p2 !== '') {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        $st = $pdo->prepare("SELECT * FROM groups WHERE invite_token = :t LIMIT 1");
        $st->execute([':t' => $p2]);
        $g = $st->fetch();
        if (!$g) json_error(404, 'لینک نامعتبر');
        if (member_of($g['id'], $me['username'])) json_out(200, ['ok' => true, 'group' => public_group($g, $me['username'])]);
        $pdo->prepare("INSERT INTO group_members (gid, username, role) VALUES (:g, :u, 'member')")
            ->execute([':g' => $g['id'], ':u' => $me['username']]);
        emit_groups_changed('group:' . $g['id']);
        json_out(200, ['ok' => true, 'group' => public_group($g, $me['username'])]);
    }

    $me = current_user();
    if (!$me) json_error(401, 'احراز هویت نامعتبر');
    $meName = $me['username'];

    // POST /api/groups {name, type}
    if ($method === 'POST' && $p0 === 'groups' && $p1 === '') {
        $name = trim((string)(isset($body['name']) ? $body['name'] : ''));
        $type = (isset($body['type']) && $body['type'] === 'channel') ? 'channel' : 'group';
        if (mb_strlen($name) < 2 || mb_strlen($name) > 60) json_error(400, 'نام گروه ۲ تا ۶۰ حرف');
        $id = substr(new_token(6), 0, 12);
        $pdo->prepare("INSERT INTO groups (id, type, name, owner, created_at) VALUES (:i, :t, :n, :o, :c)")
            ->execute([':i' => $id, ':t' => $type, ':n' => $name, ':o' => $meName, ':c' => time()]);
        $pdo->prepare("INSERT INTO group_members (gid, username, role) VALUES (:g, :u, 'owner')")
            ->execute([':g' => $id, ':u' => $meName]);
        emit_groups_changed('group:' . $id);
        json_out(200, ['ok' => true, 'group' => public_group(find_group($id), $meName)]);
    }

    if ($p0 === 'groups' && $p1 !== '' && $p1 !== 'join') {
        $g = find_group($p1);
        if (!$g) json_error(404, 'گروه یافت نشد');
        $room = 'group:' . $g['id'];
        $mem = member_of($g['id'], $meName);
        $isAdmin = $mem && is_group_admin($mem);
        $isOwner = $g['owner'] === $meName;

        if ($method === 'POST' && $p2 === 'join') {
            if ($mem) json_out(200, ['ok' => true]);
            if ($g['type'] === 'channel') json_error(403, 'کانال فقط با لینک دعوت');
            $pdo->prepare("INSERT INTO group_members (gid, username, role) VALUES (:g, :u, 'member')")
                ->execute([':g' => $g['id'], ':u' => $meName]);
            emit_groups_changed($room);
            json_out(200, ['ok' => true, 'group' => public_group($g, $meName)]);
        }
        if ($method === 'POST' && $p2 === 'leave') {
            if (!$mem) json_error(400, 'عضو نیستی');
            if ($isOwner) json_error(400, 'سازنده نمی‌تواند خارج شود (اول گروه را حذف کن)');
            $pdo->prepare("DELETE FROM group_members WHERE gid = :g AND username = :u")
                ->execute([':g' => $g['id'], ':u' => $meName]);
            emit_groups_changed($room);
            json_out(200, ['ok' => true]);
        }
        if ($method === 'POST' && $p2 === 'delete') {
            if (!$isOwner && empty($me['is_admin'])) json_error(403, 'فقط سازنده');
            $members = room_users($room);
            $pdo->prepare("DELETE FROM group_members WHERE gid = :g")->execute([':g' => $g['id']]);
            $pdo->prepare("DELETE FROM groups WHERE id = :g")->execute([':g' => $g['id']]);
            $pdo->prepare("DELETE FROM messages WHERE room = :r")->execute([':r' => $room]);
            $pdo->prepare("DELETE FROM pins WHERE room = :r")->execute([':r' => $room]);
            foreach ($members as $u) emit_event($u, 'groups-changed', [], 300);
            json_out(200, ['ok' => true]);
        }
        if ($method === 'GET' && $p2 === 'members') {
            if (!$mem) json_error(403, 'عضو نیستی');
            $st = $pdo->prepare("SELECT m.username, m.role, u.display_name, u.avatar FROM group_members m
                LEFT JOIN users u ON u.username = m.username WHERE m.gid = :g");
            $st->execute([':g' => $g['id']]);
            json_out(200, ['members' => $st->fetchAll()]);
        }
        if ($method === 'POST' && $p2 === 'members') {
            if (!$isAdmin) json_error(403, 'فقط مدیران');
            $names = isset($body['usernames']) && is_array($body['usernames']) ? $body['usernames'] : [];
            $added = 0;
            foreach (array_slice($names, 0, 50) as $n) {
                $u = is_string($n) ? find_user($n) : null;
                if (!$u || !empty($u['banned'])) continue;
                if (member_of($g['id'], $u['username'])) continue;
                $pdo->prepare("INSERT INTO group_members (gid, username, role) VALUES (:g, :u, 'member')")
                    ->execute([':g' => $g['id'], ':u' => $u['username']]);
                $added++;
            }
            emit_groups_changed($room);
            json_out(200, ['ok' => true, 'added' => $added]);
        }
        if ($method === 'POST' && $p2 === 'role') {
            if (!$isOwner) json_error(403, 'فقط سازنده');
            $target = (string)(isset($body['username']) ? $body['username'] : '');
            $role = (isset($body['role']) && $body['role'] === 'admin') ? 'admin' : 'member';
            $tm = member_of($g['id'], $target);
            if (!$tm) json_error(404, 'عضو نیست');
            if ($target === $g['owner']) json_error(400, 'نقش سازنده ثابت است');
            $pdo->prepare("UPDATE group_members SET role = :r WHERE gid = :g AND username = :u")
                ->execute([':r' => $role, ':g' => $g['id'], ':u' => $target]);
            emit_groups_changed($room);
            json_out(200, ['ok' => true]);
        }
        if ($method === 'POST' && $p2 === 'kick') {
            if (!$isAdmin) json_error(403, 'فقط مدیران');
            $target = (string)(isset($body['username']) ? $body['username'] : '');
            if ($target === $g['owner']) json_error(400, 'نمی‌شود سازنده را حذف کرد');
            if ($target === $meName) json_error(400, 'از بخش خروج استفاده کن');
            $pdo->prepare("DELETE FROM group_members WHERE gid = :g AND username = :u")
                ->execute([':g' => $g['id'], ':u' => $target]);
            emit_groups_changed($room);
            emit_event($target, 'groups-changed', [], 300);
            json_out(200, ['ok' => true]);
        }
        if ($method === 'GET' && $p2 === 'invite') {
            if (!$isAdmin) json_error(403, 'فقط مدیران');
            if (empty($g['invite_token'])) {
                $tok = new_token(16);
                $pdo->prepare("UPDATE groups SET invite_token = :t WHERE id = :g")->execute([':t' => $tok, ':g' => $g['id']]);
                $g['invite_token'] = $tok;
            }
            json_out(200, ['ok' => true, 'link' => '/join/' . $g['invite_token']]);
        }
    }

    return false;
}
