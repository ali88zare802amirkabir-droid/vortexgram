<?php
// Vortex v2 - Room helper: room ids, access control, group roles, message shape.

require_once __DIR__ . '/Db.php';

function dm_room(string $a, string $b): string {
    $p = [$a, $b];
    sort($p, SORT_STRING);
    return 'dm:' . $p[0] . '|' . $p[1];
}

function room_users(string $room): array {
    if (strpos($room, 'dm:') === 0) {
        $parts = explode('|', substr($room, 3));
        $out = [];
        foreach ($parts as $p) { if ($p !== '') $out[] = $p; }
        return $out;
    }
    if (strpos($room, 'group:') === 0) {
        $st = db()->prepare("SELECT username FROM group_members WHERE gid = :g");
        $st->execute([':g' => substr($room, 6)]);
        $rows = $st->fetchAll(PDO::FETCH_COLUMN);
        return $rows ? $rows : [];
    }
    return [];
}

function member_of(string $gid, string $username): ?array {
    $st = db()->prepare("SELECT * FROM group_members WHERE gid = :g AND username = :u LIMIT 1");
    $st->execute([':g' => $gid, ':u' => $username]);
    $r = $st->fetch();
    return $r ? $r : null;
}

function find_group(string $gid): ?array {
    $st = db()->prepare("SELECT * FROM groups WHERE id = :g LIMIT 1");
    $st->execute([':g' => $gid]);
    $r = $st->fetch();
    return $r ? $r : null;
}

function is_group_admin(array $membership): bool {
    return $membership['role'] === 'owner' || $membership['role'] === 'admin';
}

function user_is_blocked_by(string $username, string $other): bool {
    $st = db()->prepare("SELECT blocked_json FROM users WHERE username = :u LIMIT 1");
    $st->execute([':u' => $other]);
    $j = $st->fetchColumn();
    if (!$j) return false;
    $b = json_decode($j, true);
    return is_array($b) && in_array($username, $b, true);
}

function can_access(string $room, string $username): bool {
    if (strpos($room, 'dm:') === 0) {
        $parts = room_users($room);
        if (!in_array($username, $parts, true)) return false;
        foreach ($parts as $p) {
            if ($p !== $username && user_is_blocked_by($username, $p)) return false;
        }
        return true;
    }
    if (strpos($room, 'group:') === 0) {
        $g = find_group(substr($room, 6));
        return ($g && member_of($g['id'], $username) !== null);
    }
    return false;
}

function can_post(string $room, string $username): bool {
    if (strpos($room, 'group:') === 0) {
        $g = find_group(substr($room, 6));
        if (!$g) return false;
        $gtype = isset($g['type']) ? $g['type'] : 'group';
        if ($gtype === 'channel') {
            if ($g['owner'] === $username) return true;
            $m = member_of($g['id'], $username);
            return ($m && is_group_admin($m));
        }
    }
    return true;
}

function decode_json_field($v) {
    if ($v === null || $v === '') return null;
    return json_decode($v, true);
}

/** Convert a DB row to the message shape the frontend expects. */
function enrich_msg(array $r): array {
    $from = $r['from_user'];
    static $cache = [];
    if (!isset($cache[$from])) {
        $st = db()->prepare("SELECT display_name, avatar, is_premium FROM users WHERE username = :u LIMIT 1");
        $st->execute([':u' => $from]);
        $one = $st->fetch();
        $cache[$from] = $one ? $one : [];
    }
    $u = $cache[$from];
    $reactions = decode_json_field($r['reactions_json']);
    return [
        'id' => $r['id'],
        'roomId' => $r['room'],
        'from' => $from,
        'fromName' => isset($u['display_name']) ? $u['display_name'] : $from,
        'fromAvatar' => isset($u['avatar']) ? $u['avatar'] : null,
        'fromPremium' => !empty($u['is_premium']),
        'kind' => $r['kind'],
        'content' => isset($r['content']) ? $r['content'] : '',
        'url' => isset($r['url']) ? $r['url'] : null,
        'src' => isset($r['url']) ? $r['url'] : null,
        'mime' => isset($r['mime']) ? $r['mime'] : null,
        'name' => isset($r['name']) ? $r['name'] : null,
        'size' => $r['size'] !== null ? (int)$r['size'] : null,
        'duration' => $r['duration'] !== null ? (float)$r['duration'] : null,
        'wave' => decode_json_field($r['wave_json']),
        'replyTo' => decode_json_field($r['reply_json']),
        'album' => decode_json_field($r['album_json']),
        'poll' => decode_json_field($r['poll_json']),
        'checklist' => decode_json_field($r['checklist_json']),
        'reactions' => is_array($reactions) ? $reactions : new stdClass(),
        'fwdFrom' => isset($r['fwd_from']) ? $r['fwd_from'] : null,
        'time' => (int)$r['time_ms'],
        'edited' => !empty($r['edited']),
    ];
}
