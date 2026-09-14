<?php
// Vortex v2 - SSE realtime: stream ticket + event stream (replaces WebSocket).

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Events.php';

function snapshot_for(string $username, array $me): array {
    $pdo = db();
    $groups = [];
    $st = $pdo->prepare("SELECT g.* FROM groups g JOIN group_members m ON m.gid = g.id WHERE m.username = :u");
    $st->execute([':u' => $username]);
    foreach ($st->fetchAll() as $g) {
        $c = $pdo->prepare("SELECT COUNT(*) FROM group_members WHERE gid = :g");
        $c->execute([':g' => $g['id']]);
        $m = member_of($g['id'], $username);
        $groups[] = [
            'id' => $g['id'], 'type' => $g['type'], 'name' => $g['name'], 'owner' => $g['owner'],
            'members' => (int)$c->fetchColumn(), 'joined' => true,
            'myRole' => $m ? $m['role'] : null,
        ];
    }
    $chatState = [];
    $st = $pdo->prepare("SELECT room, k, v FROM chat_state WHERE username = :u");
    $st->execute([':u' => $username]);
    foreach ($st->fetchAll() as $r) {
        if (!isset($chatState[$r['room']])) $chatState[$r['room']] = [];
        $chatState[$r['room']][$r['k']] = (int)$r['v'];
    }
    $readState = [];
    foreach ($pdo->query("SELECT room, username, time_ms FROM read_state")->fetchAll() as $r) {
        if (!can_access($r['room'], $username)) continue;
        if (!isset($readState[$r['room']])) $readState[$r['room']] = [];
        $readState[$r['room']][$r['username']] = (int)$r['time_ms'];
    }
    $pinned = [];
    foreach ($pdo->query("SELECT room, msg_id FROM pins")->fetchAll() as $r) {
        if ($r['room'] === '' || !can_access($r['room'], $username)) continue;
        if (!isset($pinned[$r['room']])) $pinned[$r['room']] = [];
        $pinned[$r['room']][] = $r['msg_id'];
    }
    $users = [];
    if (!empty($me['is_admin'])) {
        $online = [];
        $t = time() - 90;
        foreach ($pdo->query("SELECT username FROM users WHERE last_seen >= " . (int)$t)->fetchAll(PDO::FETCH_COLUMN) as $u) {
            $online[$u] = true;
        }
        foreach ($pdo->query("SELECT * FROM users ORDER BY display_name")->fetchAll() as $u) {
            $p = public_user($u);
            $p['online'] = isset($online[$u['username']]);
            $users[] = $p;
        }
    }
    return ['me' => public_user($me), 'groups' => $groups, 'chatState' => $chatState,
        'readState' => $readState, 'pinned' => $pinned, 'users' => $users];
}

function handle_stream_routes(string $method, array $parts): bool {
    $p0 = isset($parts[0]) ? $parts[0] : '';

    if ($method === 'POST' && $p0 === 'stream-ticket') {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        $ticket = new_token(16);
        $st = db()->prepare("INSERT INTO stream_tickets (ticket, username, expires_at) VALUES (:t, :u, :e)");
        $st->execute([':t' => $ticket, ':u' => $me['username'], ':e' => time() + 60]);
        json_out(200, ['ticket' => $ticket, 'expiresIn' => 60]);
    }

    if ($method === 'GET' && $p0 === 'stream') {
        $ticket = isset($_GET['ticket']) ? (string)$_GET['ticket'] : '';
        $lastId = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;
        if ($lastId <= 0 && isset($_SERVER['HTTP_LAST_EVENT_ID'])) $lastId = (int)$_SERVER['HTTP_LAST_EVENT_ID'];
        if (!preg_match('/^[0-9a-f]{32}$/', $ticket)) { http_response_code(401); exit; }
        $pdo = db();
        $st = $pdo->prepare("SELECT username, expires_at FROM stream_tickets WHERE ticket = :t LIMIT 1");
        $st->execute([':t' => $ticket]);
        $row = $st->fetch();
        if (!$row || (int)$row['expires_at'] < time()) { http_response_code(401); exit; }
        $pdo->prepare("DELETE FROM stream_tickets WHERE ticket = :t")->execute([':t' => $ticket]);
        $username = $row['username'];
        $me = find_user($username);
        if (!$me || !empty($me['banned'])) { http_response_code(401); exit; }
        $pdo->prepare("UPDATE users SET last_seen = :t WHERE username = :u")
            ->execute([':t' => time(), ':u' => $username]);

        security_headers();
        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no');
        if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
        @ini_set('zlib.output_compression', '0');
        @ini_set('max_execution_time', '35');
        @set_time_limit(35);

        $send = function ($id, $type, $data) {
            echo 'id: ' . (int)$id . "\n";
            echo 'event: ' . $type . "\n";
            echo 'data: ' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
            if (function_exists('fastcgi_finish_request')) { /* keep open */ }
            @ob_flush(); @flush();
        };

        // همیشه «ready» با maxEventId فرستاده می‌شود؛ کلاینت اگر آخرین id ذخیره‌شده‌اش از این
        // مقدار بزرگ‌تر بود (مثلاً دیتابیس سرور بعد از deploy نو شده) خودش را ری‌سینک می‌کند
        // وگرنه هیچ رویداد زنده‌ای دیگر دریافت نمی‌کرد.
        $maxEv = (int)(db()->query("SELECT COALESCE(MAX(id), 0) FROM events")->fetchColumn());
        $ready = snapshot_for($username, $me);
        $ready['maxEventId'] = $maxEv;
        $send(0, 'ready', $ready);
        $start = time();
        $lastBeat = 0;
        while ((time() - $start) < 27) {
            if (connection_aborted()) break;
            $chk = find_user($username);
            if (!$chk || !empty($chk['banned'])) break;
            $evs = fetch_events($username, $lastId, 50);
            foreach ($evs as $e) {
                if ($e['type'] === 'users-changed') {
                    $fresh = find_user($username);
                    $e['data'] = ['users' => snapshot_for($username, $fresh)['users']];
                }
                if ($e['type'] === 'groups-changed') {
                    $fresh = find_user($username);
                    $e['data'] = ['groups' => snapshot_for($username, $fresh)['groups']];
                }
                $send($e['id'], $e['type'], $e['data']);
                $lastId = $e['id'];
            }
            if (time() - $lastBeat >= 10) { echo ":beat\n\n"; @ob_flush(); @flush(); $lastBeat = time(); }
            if (!$evs) sleep(1);
        }
        exit;
    }

    return false;
}
