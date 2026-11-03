<?php

declare(strict_types=1);

function env(string $key, $default = null)
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        return $default;
    }

    return $value;
}

function loadConfig(): array
{
    return [
        'db_host' => env('DB_HOST', '127.0.0.1'),
        'db_name' => env('DB_NAME', 'snapduty'),
        'db_user' => env('DB_USER', 'root'),
        'db_pass' => env('DB_PASS', ''),
        'db_port' => env('DB_PORT', '3306'),
        'jwt_secret' => env('JWT_SECRET', 'snapduty-php-dev-secret'),
    ];
}

$config = loadConfig();
