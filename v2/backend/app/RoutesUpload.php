<?php
// Vortex v2 - Uploads: strict validation (finfo sniffing, whitelist, random names).
// Files live OUTSIDE the web root (storage/uploads) and are served by PHP with safe headers.

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Util.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Room.php';
require_once __DIR__ . '/Events.php';

function upload_mime_map(): array {
    return [
        'image/jpeg' => '.jpg', 'image/png' => '.png', 'image/gif' => '.gif', 'image/webp' => '.webp',
        'video/mp4' => '.mp4', 'video/webm' => '.webm',
        'audio/mpeg' => '.mp3', 'audio/wav' => '.wav', 'audio/ogg' => '.ogg', 'audio/webm' => '.weba',
        'audio/mp4' => '.m4a', 'audio/x-m4a' => '.m4a', 'audio/aac' => '.aac', 'audio/x-matroska' => '.mka',
        'application/pdf' => '.pdf', 'application/zip' => '.zip', 'text/plain' => '.txt',
    ];
}

function uploads_dir(): string {
    $dir = rtrim(envv('STORAGE_DIR', __DIR__ . '/../storage'), '/\\') . '/uploads';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    return $dir;
}

/** Validate + store an uploaded file. Returns info array or sends JSON error. */
function store_upload(array $file, array $user, bool $imagesOnly = false): array {
    if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) json_error(400, 'آپلود ناموفق بود');
    if (!isset($file['size']) || $file['size'] <= 0) json_error(400, 'فایل خالی است');
    $maxMB = (!empty($user['is_premium']) || !empty($user['is_admin'])) ? 100 : 30;
    if ($file['size'] > $maxMB * 1024 * 1024) json_error(400, 'حداکثر ' . $maxMB . ' مگابایت');
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $sniffed = $finfo->file($file['tmp_name']);
    $mime = $sniffed ? explode(';', $sniffed)[0] : '';
    $mime = trim($mime);
    $map = upload_mime_map();
    if (!isset($map[$mime])) json_error(400, 'نوع فایل مجاز نیست');
    if ($imagesOnly && strpos($mime, 'image/') !== 0) json_error(400, 'فقط تصویر');
    $name = time() . '-' . substr(new_token(5), 0, 10) . $map[$mime];
    $dest = uploads_dir() . '/' . $name;
    if (!is_uploaded_file($file['tmp_name']) || !move_uploaded_file($file['tmp_name'], $dest)) {
        json_error(500, 'ذخیره‌ی فایل ناموفق بود');
    }
    @chmod($dest, 0600);
    $kind = $mime === 'image/gif' ? 'gif' : (strpos($mime, 'image/') === 0 ? 'image'
        : (strpos($mime, 'video/') === 0 ? 'video' : (strpos($mime, 'audio/') === 0 ? 'audio' : 'file')));
    return [
        'url' => '/uploads/' . $name, 'mime' => $mime, 'kind' => $kind,
        'name' => mb_substr((string)(isset($file['name']) ? $file['name'] : 'file'), 0, 80),
        'size' => (int)$file['size'],
    ];
}

/** Serve a stored upload with safe headers (no sniffing, no execution). */
function serve_upload(string $name): void {
    if (!preg_match('/^[0-9]+-[0-9a-f]{10}\.[a-z0-9]+$/', $name)) { http_response_code(404); exit; }
    $path = uploads_dir() . '/' . $name;
    if (!is_file($path)) { http_response_code(404); exit; }
    $ext = strtolower(substr($name, strrpos($name, '.')));
    $mime = null;
    foreach (upload_mime_map() as $m => $e) { if ($e === $ext) { $mime = $m; break; } }
    security_headers();
    header('Content-Type: ' . ($mime ? $mime : 'application/octet-stream'));
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline');
    header('Cache-Control: public, max-age=86400');
    readfile($path);
    exit;
}

function handle_upload_routes(string $method, array $parts, array $body): bool {
    $p0 = isset($parts[0]) ? $parts[0] : '';
    $p1 = isset($parts[1]) ? $parts[1] : '';

    if ($method === 'POST' && $p0 === 'upload' && $p1 === '') {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        if (!isset($_FILES['file'])) json_error(400, 'فایلی ارسال نشد');
        $info = store_upload($_FILES['file'], $me, false);
        json_out(200, $info);
    }

    if ($method === 'POST' && $p0 === 'profile' && ($p1 === 'avatar' || $p1 === 'background') && !isset($parts[2])) {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        if (!isset($_FILES['file'])) json_error(400, 'فایلی ارسال نشد');
        $info = store_upload($_FILES['file'], $me, true);
        $col = $p1 === 'avatar' ? 'avatar' : 'bg';
        db()->prepare("UPDATE users SET $col = :v WHERE username = :u")
            ->execute([':v' => $info['url'], ':u' => $me['username']]);
        emit_users_changed();
        json_out(200, ['ok' => true, 'url' => $info['url']]);
    }

    if ($method === 'POST' && $p0 === 'groups' && $p1 !== '' && isset($parts[2]) && $parts[2] === 'avatar') {
        $me = current_user();
        if (!$me) json_error(401, 'احراز هویت نامعتبر');
        $g = find_group($p1);
        if (!$g) json_error(404, 'گروه یافت نشد');
        $mem = member_of($g['id'], $me['username']);
        if ((!$mem || !is_group_admin($mem)) && empty($me['is_admin'])) json_error(403, 'فقط مدیران');
        if (!isset($_FILES['avatar']) && !isset($_FILES['file'])) json_error(400, 'فایلی ارسال نشد');
        $f = isset($_FILES['avatar']) ? $_FILES['avatar'] : $_FILES['file'];
        $info = store_upload($f, $me, true);
        db()->prepare("UPDATE groups SET avatar = :v WHERE id = :g")->execute([':v' => $info['url'], ':g' => $g['id']]);
        emit_groups_changed('group:' . $g['id']);
        json_out(200, ['ok' => true, 'avatar' => $info['url']]);
    }

    return false;
}
