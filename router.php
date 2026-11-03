<?php

declare(strict_types=1);

require_once __DIR__ . '/php/api.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($uri === '') {
    $uri = '/';
}
if (strpos($uri, '/') !== 0) {
    $uri = '/' . $uri;
}

if (preg_match('#^/api(?:/|$)#', $uri)) {
    handleApiRequest($uri, $_SERVER['REQUEST_METHOD'] ?? 'GET');
    exit;
}

$staticPath = __DIR__ . $uri;
if (preg_match('#^/app/?$#', $uri)) {
    $staticPath = __DIR__ . '/prueba prototipo.html';
} elseif ($uri === '/' || $uri === '') {
    $staticPath = __DIR__ . '/intex.html';
}

if (is_file($staticPath)) {
    $extension = strtolower(pathinfo($staticPath, PATHINFO_EXTENSION));
    $mimeTypes = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js' => 'application/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'webp' => 'image/webp',
        'jfif' => 'image/jpeg',
        'txt' => 'text/plain; charset=utf-8',
    ];

    header('Content-Type: ' . ($mimeTypes[$extension] ?? 'application/octet-stream'));
    readfile($staticPath);
    exit;
}

http_response_code(404);
echo 'Not found';
