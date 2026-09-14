<?php
// Vortex v2 - Front controller. All requests go through here.
// Local dev:  php -S 127.0.0.1:8000 -t public public/index.php

$APP = __DIR__ . '/../app';
require_once $APP . '/Config.php';
require_once $APP . '/Db.php';
require_once $APP . '/Util.php';
require_once $APP . '/Auth.php';
require_once $APP . '/Room.php';
require_once $APP . '/Events.php';
require_once $APP . '/RateLimit.php';
require_once $APP . '/RoutesAuth.php';
require_once $APP . '/RoutesStream.php';
require_once $APP . '/RoutesChat.php';
require_once $APP . '/RoutesUsers.php';
require_once $APP . '/RoutesGroups.php';
require_once $APP . '/RoutesAdmin.php';
require_once $APP . '/RoutesUpload.php';

try {
    handle_cors();
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $parts = array_values(array_filter(explode('/', trim((string)$uri, '/')), function ($p) { return $p !== ''; }));

    if ($parts === []) {
        security_headers();
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => true, 'service' => 'vortex-v2']);
        exit;
    }

    // Static uploads served by PHP with safe headers (files live outside web root).
    if ($parts[0] === 'uploads' && isset($parts[1]) && $method === 'GET') {
        serve_upload($parts[1]);
    }

    if ($parts[0] === 'api' && isset($parts[1]) && $parts[1] === 'health') {
        db();
        json_out(200, ['ok' => true, 'time' => time()]);
    }

    if ($parts[0] === 'api') {
        array_shift($parts);
        $ct = $_SERVER['CONTENT_TYPE'] ?? '';
        if (stripos($ct, 'multipart/form-data') !== false) {
            $body = $_POST;
        } else {
            $body = ($method === 'GET' || $method === 'OPTIONS') ? [] : read_json();
        }
        ensure_bot_user();
        if (handle_auth_routes($method, $parts, $body)) exit;
        if (handle_stream_routes($method, $parts)) exit;
        if (handle_chat_routes($method, $parts, $body)) exit;
        if (handle_user_routes($method, $parts, $body)) exit;
        if (handle_group_routes($method, $parts, $body)) exit;
        if (handle_admin_routes($method, $parts, $body)) exit;
        if (handle_upload_routes($method, $parts, $body)) exit;
        json_error(404, 'یافت نشد');
    }

    json_error(404, 'یافت نشد');
} catch (Throwable $e) {
    error_log('vortex-v2: ' . $e->getMessage());
    json_error(500, 'خطای داخلی سرور');
}
