<?php

declare(strict_types=1);

require_once __DIR__ . '/config.php';

$config = loadConfig();

function getPdo(): PDO
{
    global $config;

    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_port'],
        $config['db_name']
    );

    $pdo = new PDO(
        $dsn,
        $config['db_user'],
        $config['db_pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );

    ensureSchema($pdo);
    return $pdo;
}

function ensureSchema(PDO $pdo): void
{
    $exists = $pdo->query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'reflections'"
    )->fetchColumn();

    if ((int) $exists === 0) {
        $pdo->exec(
            "CREATE TABLE reflections (
                id VARCHAR(64) NOT NULL,
                user_id INT UNSIGNED NOT NULL,
                date DATE NOT NULL,
                title VARCHAR(120) DEFAULT 'Reflexión semanal',
                content TEXT NOT NULL,
                category ENUM('Atención comunitaria','Educación','Gestión','Investigación','Otro','General') DEFAULT 'General',
                hours_logged DECIMAL(6,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_reflections_user_date (user_id, date),
                CONSTRAINT fk_snapduty_php_reflections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
        );
    }
}
