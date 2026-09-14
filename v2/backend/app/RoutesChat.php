<?php
// Vortex v2 - Chat routes: history, send, edit, delete, read, typing,
// reactions, pins, polls, checklist, chat state. (Replaces WS message flow.)

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/RateLimit.php';

const MAX_MSG_LEN = 4000;
const HISTORY_LIMIT = 200;

function msg_maxlen(array $user): int {
    return (!empty($user['is_premium']) || !empty($user['is_admin'])) ? MAX_MSG_LEN : 700;
}

function get_msg(string $id): ?array {
    $st = db()->prepare("SELECT * FROM messages WHERE id = :i LIMIT 1");
    $st->execute([':i' => $id]);
    $r = $st->fetch();
    return $r ? $r : null;
}

/** Minimal AI reply in bot DM when GROQ_API_KEY is set (server-side key, never exposed). */
function maybe_ai_reply(string $roomId, array $user, string $text): void {
    $key = envv('GROQ_API_KEY', '');
    if ($key === '' || !function_exists('curl_init')) return;
    $botRoom = dm_room($user['username'], 'vortex_bot');
    if ($roomId !== $botRoom) return;
    static $last = [];
    $now = time();
    if (isset($last[$roomId]) && $now - $last[$roomId] < 5) return;
    $last[$roomId] = $now;
    $body = json_encode([
        'model' => envv('GROQ_MODEL', 'llama-3.1-8b-instant'),
        'messages' => [
            ['role' => 'system', 'content' => 'You are Vortex AI, a friendly assistant inside a messenger. Reply in Persian, short (under 120 words), warm tone.'],
            ['role' => 'user', 'content' => mb_substr($text, 0, 1000)],
        ],
        'max_tokens' => 300, 'temperature' => 0.8,
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $key, 'Content-Type: application/json',
        ],
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    if (!$res) return;
    $d = json_decode($res, true);
    $reply = isset($d['choices'][0]['message']['content']) ? trim($d['choices'][0]['message']['content']) : '';
    if ($reply === '') return;
    $botId = new_uuid();
    $st = db()->prepare("INSERT INTO messages (id, room, from_user, kind, content, time_ms)
        VALUES (:id, :room, 'vortex_bot', 'text', :c, :t)");
    $st->execute([':id' => $botId, ':room' => $roomId, ':c' => mb_substr($reply, 0, 4000), ':t' => now_ms()]);
    $row = get_msg($botId);
    emit_room($roomId, 'message', ['message' => enrich_msg($row)]);
}

function handle_chat_routes(string $method, array $parts, array $body): bool {
    $pdo = db();
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';
    $p2 = isset($parts[2]) ? $parts[2] : '';

    $me = current_user();
    $needAuth = in_array($p0, ['history', 'messages', 'read', 'typing', 'reactions', 'pin', 'poll', 'checklist', 'chats', 'my-rooms'], true);
    if ($needAuth && !$me) json_error(401, 'احراز هویت نامعتبر');
    $meName = $me ? $me['username'] : '';

    // GET /api/history?room=...&limit=..&before=..
    if ($method === 'GET' && $p0 === 'history') {
        $room = substr((string)(isset($_GET['room']) ? $_GET['room'] : ''), 0, 100);
        $limit = min(100, max(1, (int)(isset($_GET['limit']) ? $_GET['limit'] : 50)));
        $before = (int)(isset($_GET['before']) ? $_GET['before'] : 0);
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        $sql = "SELECT * FROM messages WHERE room = :r AND deleted = 0";
        $params = [':r' => $room];
        if ($before > 0) { $sql .= " AND time_ms < :b"; $params[':b'] = $before; }
        $sql .= " ORDER BY time_ms DESC LIMIT " . $limit;
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $rows = array_reverse($st->fetchAll());
        $out = [];
        foreach ($rows as $r) $out[] = enrich_msg($r);
        json_out(200, ['roomId' => $room, 'messages' => $out]);
    }

    // POST /api/messages  (send)
    if ($method === 'POST' && $p0 === 'messages' && $p1 === '' && $p2 === '') {
        if (!rate_ok('msg:' . $meName, 30, 10)) json_error(429, 'کمی آرام‌تر! تعداد پیام‌ها زیاد است.');
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        if (!can_post($room, $meName)) json_error(403, 'در کانال فقط مدیران می‌توانند پیام بفرستند');
        if (strpos($room, 'dm:') === 0) {
            $other = null;
            foreach (room_users($room) as $p) { if ($p !== $meName) $other = $p; }
            if ($other) {
                if (user_is_blocked_by($meName, $other)) json_error(403, 'شما توسط این کاربر مسدود شده‌اید');
                $myBlocked = json_decode(isset($me['blocked_json']) ? $me['blocked_json'] : '[]', true);
                if (is_array($myBlocked) && in_array($other, $myBlocked, true)) json_error(403, 'شما این کاربر را مسدود کرده‌اید');
            }
        }
        $kinds = ['text','sticker','image','gif','video','audio','voice','file','poll','checklist','album'];
        $kind = isset($body['kind']) && is_string($body['kind']) && in_array($body['kind'], $kinds, true)
            ? $body['kind'] : 'text';
        $maxLen = msg_maxlen($me);
        $content = ''; $album = null; $poll = null; $checklist = null; $mediaUrl = '';
        if ($kind === 'text') {
            $content = mb_substr((string)(isset($body['content']) ? $body['content'] : ''), 0, $maxLen);
            if (trim($content) === '') json_error(400, 'متن خالی است');
        } elseif ($kind === 'sticker') {
            $stk = trim((string)(isset($body['content']) ? $body['content'] : ''));
            if ($stk === '' || !preg_match('/^(https?:\/\/[\w.-]+\.\w{2,}|\/uploads\/[\w.\-]+)/', $stk)) json_error(400, 'استیکر نامعتبر');
            $content = mb_substr($stk, 0, 300);
        } elseif ($kind === 'album') {
            $al = isset($body['album']) && is_array($body['album']) ? $body['album'] : [];
            $album = [];
            foreach ($al as $u) {
                if (is_string($u) && preg_match('/^\/uploads\/[\w.\-]+$/', $u)) $album[] = $u;
                if (count($album) >= 10) break;
            }
            if (!$album) json_error(400, 'آلبوم خالی است');
        } elseif ($kind === 'poll' || $kind === 'checklist') {
            if ($kind === 'poll') {
                $src = isset($body['poll']) && is_array($body['poll']) ? $body['poll'] : [];
                $q = trim(mb_substr((string)(isset($src['question']) ? $src['question'] : ''), 0, 200));
                $opts = [];
                foreach ((isset($src['options']) && is_array($src['options']) ? $src['options'] : []) as $o) {
                    $t = trim(mb_substr((string)$o, 0, 80));
                    if ($t !== '') $opts[] = $t;
                    if (count($opts) >= 10) break;
                }
                if ($q === '' || count($opts) < 2) json_error(400, 'نظرسنجی نامعتبر');
                $poll = ['question' => $q, 'options' => $opts, 'votes' => new stdClass()];
            } else {
                $src = isset($body['checklist']) && is_array($body['checklist']) ? $body['checklist'] : [];
                $t = trim(mb_substr((string)(isset($src['title']) ? $src['title'] : ''), 0, 200));
                $items = [];
                foreach ((isset($src['items']) && is_array($src['items']) ? $src['items'] : []) as $i) {
                    $tx = trim(mb_substr((string)$i, 0, 120));
                    if ($tx !== '') $items[] = ['text' => $tx, 'done' => false];
                    if (count($items) >= 30) break;
                }
                if ($t === '' || !$items) json_error(400, 'چک‌لیست نامعتبر');
                $checklist = ['title' => $t, 'items' => $items];
            }
        } else {
            $mediaUrl = (string)(isset($body['url']) ? $body['url'] : (isset($body['src']) ? $body['src'] : ''));
            if (!preg_match('/^\/uploads\/[\w.\-]+$/', $mediaUrl)) json_error(400, 'فایل نامعتبر');
        }
        $replyTo = null;
        if (isset($body['replyTo']) && is_array($body['replyTo']) && isset($body['replyTo']['id'])) {
            $replyTo = [
                'id' => mb_substr((string)$body['replyTo']['id'], 0, 40),
                'name' => mb_substr((string)(isset($body['replyTo']['name']) ? $body['replyTo']['name'] : ''), 0, 40),
                'snippet' => mb_substr((string)(isset($body['replyTo']['snippet']) ? $body['replyTo']['snippet'] : ''), 0, 120),
            ];
        }
        $wave = null;
        if (isset($body['wave']) && is_array($body['wave'])) {
            $wave = [];
            foreach (array_slice($body['wave'], 0, 100) as $v) {
                if (is_numeric($v)) $wave[] = max(0, min(1, (float)$v));
            }
        }
        $id = new_uuid();
        $t = now_ms();
        $st = $pdo->prepare("INSERT INTO messages (id, room, from_user, kind, content, url, mime, name, size, duration,
            wave_json, reply_json, album_json, poll_json, checklist_json, reactions_json, fwd_from, time_ms)
            VALUES (:id, :room, :f, :k, :c, :u, :m, :n, :s, :d, :w, :r, :a, :p, :cl, '{}', :fwd, :t)");
        $st->execute([
            ':id' => $id, ':room' => $room, ':f' => $meName, ':k' => $kind, ':c' => $content,
            ':u' => $mediaUrl !== '' ? $mediaUrl : null,
            ':m' => isset($body['mime']) ? mb_substr((string)$body['mime'], 0, 60) : null,
            ':n' => isset($body['name']) ? mb_substr((string)$body['name'], 0, 80) : null,
            ':s' => isset($body['size']) && $body['size'] > 0 ? (int)$body['size'] : null,
            ':d' => isset($body['duration']) && $body['duration'] > 0 ? min(3600, (float)$body['duration']) : null,
            ':w' => $wave ? json_encode($wave) : null,
            ':r' => $replyTo ? json_encode($replyTo, JSON_UNESCAPED_UNICODE) : null,
            ':a' => $album ? json_encode($album) : null,
            ':p' => $poll ? json_encode($poll, JSON_UNESCAPED_UNICODE) : null,
            ':cl' => $checklist ? json_encode($checklist, JSON_UNESCAPED_UNICODE) : null,
            ':fwd' => isset($body['fwdFrom']) ? mb_substr((string)$body['fwdFrom'], 0, 40) : null,
            ':t' => $t,
        ]);
        $msg = enrich_msg(get_msg($id));
        emit_room($room, 'message', ['message' => $msg]);
        if ($kind === 'text') maybe_ai_reply($room, $me, $content);
        json_out(200, ['ok' => true, 'message' => $msg]);
    }

    // POST /api/messages/:id/edit  |  POST /api/messages/:id/delete
    if ($method === 'POST' && $p0 === 'messages' && $p1 !== '' && ($p2 === 'edit' || $p2 === 'delete')) {
        $m = get_msg($p1);
        if (!$m || !empty($m['deleted'])) json_error(404, 'پیام یافت نشد');
        $room = $m['room'];
        $isOwner = $m['from_user'] === $meName;
        $canMod = $isOwner;
        if (!$canMod && strpos($room, 'group:') === 0) {
            $mem = member_of(substr($room, 6), $meName);
            if ($mem && is_group_admin($mem)) $canMod = true;
        }
        if (!$canMod && !empty($me['is_admin'])) $canMod = true;
        if (!$canMod) json_error(403, 'اجازه نداری');
        if ($p2 === 'edit') {
            if (!$isOwner) json_error(403, 'فقط فرستنده می‌تواند ویرایش کند');
            if ($m['kind'] !== 'text') json_error(400, 'فقط پیام متنی');
            $content = mb_substr(trim((string)(isset($body['content']) ? $body['content'] : '')), 0, msg_maxlen($me));
            if ($content === '') json_error(400, 'متن خالی است');
            $pdo->prepare("UPDATE messages SET content = :c, edited = 1 WHERE id = :i")
                ->execute([':c' => $content, ':i' => $m['id']]);
            emit_room($room, 'message-edited', ['id' => $m['id'], 'roomId' => $room, 'content' => $content]);
            json_out(200, ['ok' => true]);
        } else {
            $pdo->prepare("UPDATE messages SET deleted = 1 WHERE id = :i")->execute([':i' => $m['id']]);
            $pdo->prepare("DELETE FROM pins WHERE msg_id = :i")->execute([':i' => $m['id']]);
            emit_room($room, 'message-deleted', ['id' => $m['id'], 'roomId' => $room]);
            json_out(200, ['ok' => true]);
        }
    }

    // POST /api/read  |  POST /api/chats/read
    if ($method === 'POST' && (($p0 === 'read' && $p1 === '') || ($p0 === 'chats' && $p1 === 'read'))) {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        $t = now_ms();
        $pdo->prepare("INSERT INTO read_state (room, username, time_ms) VALUES (:r, :u, :t)
            ON CONFLICT(room, username) DO UPDATE SET time_ms = :t2")
            ->execute([':r' => $room, ':u' => $meName, ':t' => $t, ':t2' => $t]);
        emit_room($room, 'room-read', ['roomId' => $room, 'username' => $meName, 'time' => $t], $meName);
        json_out(200, ['ok' => true]);
    }

    // POST /api/typing {roomId, on}
    if ($method === 'POST' && $p0 === 'typing' && $p1 === '') {
        if (!rate_ok('typing:' . $meName, 20, 10)) json_out(200, ['ok' => true]);
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        emit_room($room, 'typing', ['roomId' => $room, 'username' => $meName, 'on' => !empty($body['on'])], $meName, 15);
        json_out(200, ['ok' => true]);
    }

    // POST /api/reactions {roomId, id, emoji} — تک‌ری‌اکشن برای هر کاربر
    if ($method === 'POST' && $p0 === 'reactions' && $p1 === '') {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        $id = (string)(isset($body['id']) ? $body['id'] : '');
        $emoji = mb_substr((string)(isset($body['emoji']) ? $body['emoji'] : ''), 0, 12);
        $m = get_msg($id);
        if (!$m || $m['room'] !== $room || !empty($m['deleted'])) json_error(404, 'پیام یافت نشد');
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        $rs = json_decode(isset($m['reactions_json']) ? $m['reactions_json'] : '{}', true);
        if (!is_array($rs)) $rs = [];
        foreach ($rs as $em => $users) {
            $rs[$em] = array_values(array_filter((array)$users, function ($u) use ($meName) { return $u !== $meName; }));
            if (!$rs[$em]) unset($rs[$em]);
        }
        if ($emoji !== '' && !isset($rs[$emoji])) $rs[$emoji] = [$meName];
        $pdo->prepare("UPDATE messages SET reactions_json = :r WHERE id = :i")
            ->execute([':r' => json_encode($rs, JSON_UNESCAPED_UNICODE), ':i' => $id]);
        $msg = enrich_msg(get_msg($id));
        emit_room($room, 'message-updated', ['message' => $msg]);
        json_out(200, ['ok' => true, 'message' => $msg]);
    }

    // POST /api/pin {roomId, id, pin}
    if ($method === 'POST' && $p0 === 'pin' && $p1 === '') {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        $id = (string)(isset($body['id']) ? $body['id'] : '');
        $pin = !empty($body['pin']);
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        if (strpos($room, 'group:') === 0) {
            $mem = member_of(substr($room, 6), $meName);
            if (!$mem || !is_group_admin($mem)) json_error(403, 'فقط مدیران');
        }
        if ($pin) {
            $m = get_msg($id);
            if (!$m || $m['room'] !== $room || !empty($m['deleted'])) json_error(404, 'پیام یافت نشد');
            $c = $pdo->prepare("SELECT COUNT(*) FROM pins WHERE room = :r");
            $c->execute([':r' => $room]);
            if ((int)$c->fetchColumn() >= 20) json_error(400, 'سقف ۲۰ پین');
            $pdo->prepare("INSERT OR IGNORE INTO pins (room, msg_id) VALUES (:r, :i)")
                ->execute([':r' => $room, ':i' => $id]);
        } else {
            $pdo->prepare("DELETE FROM pins WHERE room = :r AND msg_id = :i")->execute([':r' => $room, ':i' => $id]);
        }
        $st = $pdo->prepare("SELECT msg_id FROM pins WHERE room = :r");
        $st->execute([':r' => $room]);
        $ids = $st->fetchAll(PDO::FETCH_COLUMN) ?: [];
        emit_room($room, 'pinned-updated', ['roomId' => $room, 'ids' => $ids]);
        json_out(200, ['ok' => true, 'ids' => $ids]);
    }

    // POST /api/poll/vote {roomId, id, option}
    if ($method === 'POST' && $p0 === 'poll' && $p1 === 'vote') {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        $id = (string)(isset($body['id']) ? $body['id'] : '');
        $opt = (int)(isset($body['option']) ? $body['option'] : -1);
        $m = get_msg($id);
        if (!$m || $m['room'] !== $room || $m['kind'] !== 'poll') json_error(404, 'نظرسنجی یافت نشد');
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        $poll = json_decode(isset($m['poll_json']) ? $m['poll_json'] : '{}', true);
        if (!is_array($poll) || !isset($poll['options'][$opt])) json_error(400, 'گزینه نامعتبر');
        $votes = isset($poll['votes']) && is_array($poll['votes']) ? $poll['votes'] : [];
        foreach ($votes as $k => $users) {
            $votes[$k] = array_values(array_filter((array)$users, function ($u) use ($meName) { return $u !== $meName; }));
        }
        $votes[(string)$opt][] = $meName;
        $poll['votes'] = $votes;
        $pdo->prepare("UPDATE messages SET poll_json = :p WHERE id = :i")
            ->execute([':p' => json_encode($poll, JSON_UNESCAPED_UNICODE), ':i' => $id]);
        $msg = enrich_msg(get_msg($id));
        emit_room($room, 'message-updated', ['message' => $msg]);
        json_out(200, ['ok' => true, 'message' => $msg]);
    }

    // POST /api/checklist/toggle {roomId, id, index}
    if ($method === 'POST' && $p0 === 'checklist' && $p1 === 'toggle') {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        $id = (string)(isset($body['id']) ? $body['id'] : '');
        $idx = (int)(isset($body['index']) ? $body['index'] : -1);
        $m = get_msg($id);
        if (!$m || $m['room'] !== $room || $m['kind'] !== 'checklist') json_error(404, 'چک‌لیست یافت نشد');
        if (!can_access($room, $meName)) json_error(403, 'دسترسی نداری');
        $cl = json_decode(isset($m['checklist_json']) ? $m['checklist_json'] : '{}', true);
        if (!is_array($cl) || !isset($cl['items'][$idx])) json_error(400, 'آیتم نامعتبر');
        $cl['items'][$idx]['done'] = empty($cl['items'][$idx]['done']);
        $pdo->prepare("UPDATE messages SET checklist_json = :c WHERE id = :i")
            ->execute([':c' => json_encode($cl, JSON_UNESCAPED_UNICODE), ':i' => $id]);
        $msg = enrich_msg(get_msg($id));
        emit_room($room, 'message-updated', ['message' => $msg]);
        json_out(200, ['ok' => true, 'message' => $msg]);
    }

    // POST /api/chats/state {roomId, key, value}
    if ($method === 'POST' && $p0 === 'chats' && $p1 === 'state') {
        $room = substr((string)(isset($body['roomId']) ? $body['roomId'] : ''), 0, 100);
        $key = (string)(isset($body['key']) ? $body['key'] : '');
        if (!in_array($key, ['pinned', 'archived', 'muted', 'hidden', 'locked'], true)) json_error(400, 'کلید نامعتبر');
        $v = !empty($body['value']) ? 1 : 0;
        $pdo->prepare("INSERT INTO chat_state (room, username, k, v) VALUES (:r, :u, :k, :v)
            ON CONFLICT(room, username, k) DO UPDATE SET v = :v2")
            ->execute([':r' => $room, ':u' => $meName, ':k' => $key, ':v' => $v, ':v2' => $v]);
        json_out(200, ['ok' => true]);
    }

    // GET /api/my-rooms — rooms I participate in, with last message + unread count
    if ($method === 'GET' && $p0 === 'my-rooms') {
        $seen = [];
        $st = $pdo->query("SELECT DISTINCT room FROM messages");
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $room) {
            if (!can_access($room, $meName)) continue;
            $seen[$room] = true;
        }
        $st = $pdo->prepare("SELECT gid FROM group_members WHERE username = :u");
        $st->execute([':u' => $meName]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $gid) $seen['group:' . $gid] = true;
        $seen[dm_room($meName, 'vortex_bot')] = true;
        $rs = $pdo->prepare("SELECT time_ms FROM read_state WHERE room = :r AND username = :u");
        $lm = $pdo->prepare("SELECT * FROM messages WHERE room = :r AND deleted = 0 ORDER BY time_ms DESC LIMIT 1");
        $uc = $pdo->prepare("SELECT COUNT(*) FROM messages WHERE room = :r AND deleted = 0 AND time_ms > :t AND from_user != :u");
        $out = [];
        foreach (array_keys($seen) as $room) {
            $lm->execute([':r' => $room]);
            $last = $lm->fetch();
            $rs->execute([':r' => $room, ':u' => $meName]);
            $read = (int)($rs->fetchColumn() ?: 0);
            $uc->execute([':r' => $room, ':t' => $read, ':u' => $meName]);
            $out[] = [
                'roomId' => $room,
                'last' => $last ? enrich_msg($last) : null,
                'unread' => (int)$uc->fetchColumn(),
            ];
        }
        json_out(200, ['rooms' => $out]);
    }

    return false;
}
