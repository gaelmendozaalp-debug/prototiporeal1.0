<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$config = loadConfig();

function base64UrlEncode(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function base64UrlDecode(string $value): string
{
    $pad = strlen($value) % 4;
    if ($pad > 0) {
        $value .= str_repeat('=', 4 - $pad);
    }

    return base64_decode(strtr($value, '-_', '+/'), true) ?: '';
}

function jwtSign(array $payload): string
{
    global $config;

    $header = base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_UNESCAPED_UNICODE));
    $body = base64UrlEncode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $signature = hash_hmac('sha256', $header . '.' . $body, $config['jwt_secret'], true);

    return $header . '.' . $body . '.' . base64UrlEncode($signature);
}

function jwtVerify(string $token): ?array
{
    global $config;

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }

    [$header, $payload, $signature] = $parts;
    $expected = base64UrlEncode(hash_hmac('sha256', $header . '.' . $payload, $config['jwt_secret'], true));

    if (!hash_equals($expected, $signature)) {
        return null;
    }

    $decoded = json_decode(base64UrlDecode($payload), true);
    if (!is_array($decoded)) {
        return null;
    }

    return $decoded;
}
