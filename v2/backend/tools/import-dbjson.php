<?php
// Vortex v1 (db.json) -> v2 (SQLite) migration.
// Usage:  php tools/import-dbjson.php /path/to/db.json
//
// - Users, groups (+members/roles), messages and pins are migrated.
// - Passwords: v1 used sha256(salt:password). They are stored as
//   "legacy:salt:hash" and transparently upgraded to bcrypt on first login.
// - Sessions and OTP codes are NEVER migrated (everyone logs in again).

if (PHP_SAPI !== 'cli') { echo "CLI only\n"; exit(1); }
if ($argc < 2 || !is_readable($argv[1])) { echo "Usage: php import-dbjson.php /path/to/db.json\n"; exit(1); }

require_once __DIR__ . '/../app/Db.php';
require_once __DIR__ . '/../app/Auth.php';

$raw = json_decode(file_get_contents($argv[1]), true);
if (!is_array($raw)) { echo "Invalid JSON\n"; exit(1); }

$pdo = db();
ensure_bot_user();

$nu = $ng = $nm = $np = 0;
$pdo->beginTransaction();
try {
    foreach (($raw['users'] ?? []) as $u) {
        if (!is_array($u) || empty($u['username'])) continue;
        $st = $pdo->prepare("SELECT 1 FROM users WHERE lower(username) = lower(:u)");
        $st->execute([':u' => $u['username']]);
        if ($st->fetchColumn()) continue;
        $pass = null;
        if (!empty($u['passHash']) && !empty($u['salt'])) {
            $pass = 'legacy:' . $u['salt'] . ':' . $u['passHash'];
        } elseif (!empty($u['passHash']) && strpos($u['passHash'], '$2') === 0) {
            $pass = $u['passHash'];
        }
        $ins = $pdo->prepare("INSERT INTO users (username, phone, display_name, pass_hash, is_admin,
            is_premium, banned, avatar, bio, skin, effect, effect_color, bg, blocked_json, created_at)
            VALUES (:u, :p, :d, :h, :a, :pr, :b, :av, :bio, :sk, :ef, :ec, :bg, :bl, :c)");
        $ins->execute([
            ':u' => $u['username'], ':p' => $u['phone'] ?? null,
            ':d' => $u['displayName'] ?? $u['username'], ':h' => $pass,
            ':a' => !empty($u['isAdmin']) ? 1 : 0, ':pr' => !empty($u['isPremium']) ? 1 : 0,
            ':b' => !empty($u['banned']) ? 1 : 0, ':av' => $u['avatar'] ?? null,
            ':bio' => $u['bio'] ?? '', ':sk' => $u['activeSkin'] ?? 'default',
            ':ef' => $u['profileEffect'] ?? 'off', ':ec' => $u['profileEffectColor'] ?? null,
            ':bg' => $u['profileBg'] ?? null,
            ':bl' => json_encode(is_array($u['blocked'] ?? null) ? $u['blocked'] : []),
            ':c' => (int)($u['createdAt'] ?? time()),
        ]);
        $nu++;
    }

    foreach (($raw['groups'] ?? []) as $g) {
        if (!is_array($g) || empty($g['id'])) continue;
        $st = $pdo->prepare("SELECT 1 FROM groups WHERE id = :g");
        $st->execute([':g' => $g['id']]);
        if ($st->fetchColumn()) continue;
        $ins = $pdo->prepare("INSERT INTO groups (id, type, name, owner, avatar, invite_token, created_at)
            VALUES (:i, :t, :n, :o, :a, :tok, :c)");
        $ins->execute([
            ':i' => $g['id'], ':t' => $g['type'] ?? 'group', ':n' => $g['name'] ?? 'group',
            ':o' => $g['owner'] ?? '', ':a' => $g['avatar'] ?? null,
            ':tok' => $g['inviteToken'] ?? $g['invite_token'] ?? null,
            ':c' => (int)($g['createdAt'] ?? time()),
        ]);
        foreach (($g['members'] ?? []) as $m) {
            $un = is_string($m) ? $m : ($m['username'] ?? '');
            if ($un === '') continue;
            $role = is_array($m) ? ($m['role'] ?? 'member') : ($un === ($g['owner'] ?? '') ? 'owner' : 'member');
            $pdo->prepare("INSERT OR IGNORE INTO group_members (gid, username, role) VALUES (:g, :u, :r)")
                ->execute([':g' => $g['id'], ':u' => $un, ':r' => $role]);
        }
        $ng++;
    }

    foreach (($raw['messages'] ?? []) as $room => $list) {
        if (!is_array($list)) continue;
        foreach ($list as $m) {
            if (!is_array($m) || empty($m['id'])) continue;
            $st = $pdo->prepare("SELECT 1 FROM messages WHERE id = :i");
            $st->execute([':i' => $m['id']]);
            if ($st->fetchColumn()) continue;
            $re = $m['reactions'] ?? null;
            $ins = $pdo->prepare("INSERT INTO messages (id, room, from_user, kind, content, url, mime, name,
                size, duration, wave_json, reply_json, album_json, poll_json, checklist_json,
                reactions_json, fwd_from, time_ms) VALUES (:id, :room, :f, :k, :c, :u, :m, :n, :s, :d,
                :w, :r, :a, :p, :cl, :re, :fwd, :t)");
            $ins->execute([
                ':id' => $m['id'], ':room' => is_string($room) ? $room : ($m['roomId'] ?? ''),
                ':f' => $m['from'] ?? '', ':k' => $m['kind'] ?? 'text', ':c' => $m['content'] ?? '',
                ':u' => $m['url'] ?? $m['src'] ?? null, ':m' => $m['mime'] ?? null,
                ':n' => $m['name'] ?? null, ':s' => isset($m['size']) ? (int)$m['size'] : null,
                ':d' => isset($m['duration']) ? (float)$m['duration'] : null,
                ':w' => isset($m['wave']) ? json_encode($m['wave']) : null,
                ':r' => isset($m['replyTo']) ? json_encode($m['replyTo'], JSON_UNESCAPED_UNICODE) : null,
                ':a' => isset($m['album']) ? json_encode($m['album']) : null,
                ':p' => isset($m['poll']) ? json_encode($m['poll'], JSON_UNESCAPED_UNICODE) : null,
                ':cl' => isset($m['checklist']) ? json_encode($m['checklist'], JSON_UNESCAPED_UNICODE) : null,
                ':re' => is_array($re) ? json_encode($re, JSON_UNESCAPED_UNICODE) : '{}',
                ':fwd' => $m['fwdFrom'] ?? null, ':t' => (int)($m['time'] ?? time() * 1000),
            ]);
            $nm++;
        }
    }

    $pins = $raw['pinned'] ?? [];
    if (is_array($pins)) {
        foreach ($pins as $room => $ids) {
            foreach ((array)$ids as $id) {
                $pdo->prepare("INSERT OR IGNORE INTO pins (room, msg_id) VALUES (:r, :i)")
                    ->execute([':r' => (string)$room, ':i' => (string)$id]);
                $np++;
            }
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    echo "FAILED: " . $e->getMessage() . "\n";
    exit(1);
}

echo "Done. users=$nu groups=$ng messages=$nm pins=$np\n";
