<?php

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/jwt.php';

function sendJson(int $statusCode, array $payload): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function userPublic(array $row): array
{
    unset($row['password']);
    unset($row['password_hash']);
    $row['id'] = (int) ($row['id'] ?? 0);
    $row['daily_hours'] = (float) ($row['daily_hours'] ?? 4);
    $row['weekly_hours'] = (float) ($row['weekly_hours'] ?? 20);
    $row['total_hours'] = (float) ($row['total_hours'] ?? 480);
    return $row;
}

function getBearerToken(): ?string
{
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s+(.+)/i', $authorization, $matches)) {
        return $matches[1];
    }

    return null;
}

function currentUser(): ?array
{
    $token = getBearerToken();
    if (!$token) {
        return null;
    }

    $payload = jwtVerify($token);
    if (!$payload || empty($payload['sub'])) {
        return null;
    }

    $pdo = getPdo();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => (int) $payload['sub']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function requireAuth(): array
{
    $user = currentUser();
    if (!$user) {
        sendJson(401, ['success' => false, 'error' => 'No autorizado']);
    }

    return $user;
}

function normalizeActivityRow(array $row): array
{
    return [
        'id' => (string) ($row['id'] ?? ''),
        'title' => (string) ($row['title'] ?? ''),
        'date' => (string) ($row['date'] ?? ''),
        'category' => (string) ($row['category'] ?? 'Otro'),
        'start' => substr((string) ($row['start_time'] ?? ''), 0, 5),
        'end' => substr((string) ($row['end_time'] ?? ''), 0, 5),
        'priority' => (string) ($row['priority'] ?? 'medium'),
        'notes' => (string) ($row['notes'] ?? ''),
        'done' => (bool) ($row['done'] ?? false),
        'createdAt' => $row['created_at'] ?? null,
    ];
}

function normalizeTimerRow(array $row): array
{
    return [
        'startAt' => (float) ($row['start_at'] ?? 0),
        'activeSince' => $row['active_since'] !== null ? (float) $row['active_since'] : null,
        'pausedAt' => $row['paused_at'] !== null ? (float) $row['paused_at'] : null,
        'elapsedMs' => (float) ($row['elapsed_ms'] ?? 0),
        'targetHours' => (float) ($row['target_hours'] ?? 4),
        'endAt' => $row['end_at'] !== null ? (float) $row['end_at'] : null,
        'hoursWorked' => (float) ($row['hours_worked'] ?? 0),
        'notified' => (bool) ($row['notified'] ?? false),
        'notes' => (string) ($row['notes'] ?? ''),
    ];
}

function ensureDemoUser(): void
{
    $pdo = getPdo();
    $demoEmail = 'estudiante.demo@snapduty.com';
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => $demoEmail]);
    if ($stmt->fetch()) {
        return;
    }

    $password = password_hash('PasswordDemo123!', PASSWORD_BCRYPT);
    $insert = $pdo->prepare(
        'INSERT INTO users (name, email, password_hash, institution, daily_hours, weekly_hours, total_hours) VALUES (:name, :email, :password_hash, :institution, :daily_hours, :weekly_hours, :total_hours)'
    );
    $insert->execute([
        ':name' => 'Estudiante Demo',
        ':email' => $demoEmail,
        ':password_hash' => $password,
        ':institution' => 'Facultad de Ciencias y Humanidades',
        ':daily_hours' => 4,
        ':weekly_hours' => 20,
        ':total_hours' => 480,
    ]);

    $userId = (int) $pdo->lastInsertId();
    $today = date('Y-m-d');

    $pdo->prepare(
        'INSERT INTO user_settings (user_id, theme, reflection) VALUES (:user_id, :theme, :reflection)'
    )->execute([
        ':user_id' => $userId,
        ':theme' => 'dark',
        ':reflection' => 'El servicio social me ha permitido conectar con realidades distintas y poner mis conocimientos al servicio de los demás.',
    ]);

    $pdo->prepare(
        'INSERT INTO activities (id, user_id, title, date, category, start_time, end_time, priority, notes, done) VALUES (:id, :user_id, :title, :date, :category, :start_time, :end_time, :priority, :notes, :done)'
    )->execute([
        ':id' => 'demo-act-1',
        ':user_id' => $userId,
        ':title' => 'Taller de apoyo escolar comunitario',
        ':date' => $today,
        ':category' => 'Educación',
        ':start_time' => '09:00',
        ':end_time' => '11:00',
        ':priority' => 'high',
        ':notes' => 'Lectura guiada y regularización de matemáticas.',
        ':done' => 1,
    ]);

    $pdo->prepare(
        'INSERT INTO activities (id, user_id, title, date, category, start_time, end_time, priority, notes, done) VALUES (:id, :user_id, :title, :date, :category, :start_time, :end_time, :priority, :notes, :done)'
    )->execute([
        ':id' => 'demo-act-2',
        ':user_id' => $userId,
        ':title' => 'Entrega de paquetes de útiles escolares',
        ':date' => $today,
        ':category' => 'Atención comunitaria',
        ':start_time' => '11:30',
        ':end_time' => '13:00',
        ':priority' => 'medium',
        ':notes' => 'Módulo de atención en el centro vecinal.',
        ':done' => 0,
    ]);

    $startAt = (int) (time() * 1000) - 3600000;
    $pdo->prepare(
        'INSERT INTO service_timers (user_id, date, start_at, active_since, paused_at, elapsed_ms, notified) VALUES (:user_id, :date, :start_at, :active_since, :paused_at, :elapsed_ms, :notified)'
    )->execute([
        ':user_id' => $userId,
        ':date' => $today,
        ':start_at' => $startAt,
        ':active_since' => $startAt,
        ':paused_at' => null,
        ':elapsed_ms' => 0,
        ':notified' => 0,
    ]);
}

function issueToken(array $user): string
{
    return jwtSign([
        'sub' => (int) $user['id'],
        'email' => $user['email'],
        'name' => $user['name'],
        'exp' => time() + (30 * 24 * 60 * 60),
    ]);
}

function handleApiRequest(string $path, string $method): void
{
    if ($method === 'OPTIONS') {
        sendJson(200, ['success' => true]);
    }

    $segments = array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));
    if (!isset($segments[0]) || $segments[0] !== 'api') {
        sendJson(404, ['success' => false, 'error' => 'Ruta no encontrada']);
    }

    $resource = $segments[1] ?? '';
    if ($resource === 'status') {
        sendJson(200, [
            'status' => 'ok',
            'database' => 'MySQL',
            'connected' => true,
            'authEnabled' => true,
            'totalSystemRecords' => [
                'activities' => 0,
                'serviceTimers' => 0,
                'reflections' => 0,
            ],
            'timestamp' => gmdate('c'),
        ]);
    }

    if (($segments[1] ?? '') === 'auth') {
        $action = $segments[2] ?? '';
        $pdo = getPdo();

        if ($method === 'POST' && $action === 'login') {
            $data = readJsonBody();
            $email = strtolower(trim((string) ($data['email'] ?? '')));
            $password = (string) ($data['password'] ?? '');
            if ($email === '' || $password === '') {
                sendJson(400, ['success' => false, 'error' => 'Ingresa correo y contraseña']);
            }

            $stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
            $stmt->execute([':email' => $email]);
            $user = $stmt->fetch();

            if (!$user || !password_verify($password, $user['password_hash'])) {
                sendJson(401, ['success' => false, 'error' => 'Credenciales inválidas. Verifica tu correo y contraseña.']);
            }

            sendJson(200, [
                'success' => true,
                'message' => '¡Bienvenido de nuevo, ' . $user['name'] . '!',
                'token' => issueToken($user),
                'user' => userPublic($user),
            ]);
        }

        if ($method === 'POST' && $action === 'register') {
            $data = readJsonBody();
            $name = trim((string) ($data['name'] ?? ''));
            $email = strtolower(trim((string) ($data['email'] ?? '')));
            $password = (string) ($data['password'] ?? '');
            if ($name === '') {
                sendJson(400, ['success' => false, 'error' => 'El nombre es obligatorio']);
            }
            if ($email === '') {
                sendJson(400, ['success' => false, 'error' => 'El correo electrónico es obligatorio']);
            }
            if (strlen($password) < 6) {
                sendJson(400, ['success' => false, 'error' => 'La contraseña debe tener al menos 6 caracteres']);
            }

            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $stmt->execute([':email' => $email]);
            if ($stmt->fetch()) {
                sendJson(400, ['success' => false, 'error' => 'Ya existe una cuenta con este correo electrónico']);
            }

            $hash = password_hash($password, PASSWORD_BCRYPT);
            $insert = $pdo->prepare(
                'INSERT INTO users (name, email, password_hash, institution) VALUES (:name, :email, :password_hash, :institution)'
            );
            $insert->execute([
                ':name' => $name,
                ':email' => $email,
                ':password_hash' => $hash,
                ':institution' => trim((string) ($data['institution'] ?? 'Universidad')),
            ]);

            $userId = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO user_settings (user_id, theme, reflection) VALUES (:user_id, :theme, :reflection)')->execute([
                ':user_id' => $userId,
                ':theme' => 'dark',
                ':reflection' => '',
            ]);

            $user = $pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
            $user->execute([':id' => $userId]);
            $registered = $user->fetch();
            sendJson(201, [
                'success' => true,
                'message' => 'Cuenta creada exitosamente',
                'token' => issueToken($registered),
                'user' => userPublic($registered),
            ]);
        }

        if ($method === 'POST' && $action === 'demo') {
            ensureDemoUser();
            $stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
            $stmt->execute([':email' => 'estudiante.demo@snapduty.com']);
            $user = $stmt->fetch();
            sendJson(200, [
                'success' => true,
                'message' => 'Sesión iniciada con cuenta Demo',
                'token' => issueToken($user),
                'user' => userPublic($user),
            ]);
        }

        if ($method === 'GET' && $action === 'me') {
            $user = requireAuth();
            sendJson(200, ['success' => true, 'user' => userPublic($user)]);
        }
    }

    if (($segments[1] ?? '') === 'bootstrap') {
        $user = requireAuth();
        $stmt = $pdo = getPdo();
        $activities = $pdo->prepare('SELECT * FROM activities WHERE user_id = :user_id ORDER BY date ASC, start_time ASC');
        $activities->execute([':user_id' => (int) $user['id']]);
        $activitiesRows = $activities->fetchAll();

        $timers = $pdo->prepare('SELECT *, date AS service_date, 4 AS target_hours, \'\' AS notes FROM service_timers WHERE user_id = :user_id ORDER BY date ASC');
        $timers->execute([':user_id' => (int) $user['id']]);
        $timerRows = $timers->fetchAll();

        $settings = $pdo->prepare('SELECT theme, reflection FROM user_settings WHERE user_id = :user_id LIMIT 1');
        $settings->execute([':user_id' => (int) $user['id']]);
        $settingRow = $settings->fetch() ?: [];

        $reflections = $pdo->prepare('SELECT * FROM reflections WHERE user_id = :user_id ORDER BY date DESC LIMIT 10');
        $reflections->execute([':user_id' => (int) $user['id']]);
        $recent = $reflections->fetchAll();

        $timerMap = [];
        foreach ($timerRows as $row) {
            $timerMap[$row['service_date']] = normalizeTimerRow($row);
        }

        sendJson(200, ['success' => true, 'data' => [
            'user' => ['id' => (int) $user['id'], 'name' => $user['name'], 'email' => $user['email'], 'institution' => $user['institution'], 'programName' => ''],
            'goals' => ['dailyHours' => (float) ($user['daily_hours'] ?? 4), 'weeklyHours' => (float) ($user['weekly_hours'] ?? 20), 'totalHours' => (float) ($user['total_hours'] ?? 480)],
            'activities' => array_map('normalizeActivityRow', $activitiesRows),
            'serviceTimers' => $timerMap,
            'theme' => $settingRow['theme'] ?? 'dark',
            'interfacePreferences' => null,
            'reflection' => $settingRow['reflection'] ?? '',
            'reflections' => array_map(function ($row) { return ['id' => $row['id'], 'date' => $row['date'], 'title' => $row['title'], 'content' => $row['content'], 'category' => $row['category'], 'hoursLogged' => (float) $row['hours_logged']]; }, $recent),
        ]]);
    }

    if (($segments[1] ?? '') === 'activities') {
        $user = requireAuth();
        $pdo = getPdo();
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM activities WHERE user_id = :user_id ORDER BY date ASC, start_time ASC');
            $stmt->execute([':user_id' => (int) $user['id']]);
            $rows = $stmt->fetchAll();
            sendJson(200, ['success' => true, 'count' => count($rows), 'activities' => array_map('normalizeActivityRow', $rows)]);
        }

        if ($method === 'POST') {
            $data = readJsonBody();
            $title = trim((string) ($data['title'] ?? ''));
            $date = (string) ($data['date'] ?? '');
            if ($title === '') {
                sendJson(400, ['success' => false, 'error' => 'El título es obligatorio']);
            }
            $activityId = (string) ($data['id'] ?? ('act-' . time() . '-' . bin2hex(random_bytes(4))));
            $start = (string) ($data['start'] ?? '');
            $end = (string) ($data['end'] ?? '');
            $pdo->prepare(
                'INSERT INTO activities (id, user_id, title, date, category, start_time, end_time, priority, notes, done) VALUES (:id, :user_id, :title, :date, :category, :start_time, :end_time, :priority, :notes, :done) ON DUPLICATE KEY UPDATE title = VALUES(title), date = VALUES(date), category = VALUES(category), start_time = VALUES(start_time), end_time = VALUES(end_time), priority = VALUES(priority), notes = VALUES(notes), done = VALUES(done)'
            )->execute([
                ':id' => $activityId,
                ':user_id' => (int) $user['id'],
                ':title' => $title,
                ':date' => $date,
                ':category' => (string) ($data['category'] ?? 'Otro'),
                ':start_time' => $start !== '' ? $start : null,
                ':end_time' => $end !== '' ? $end : null,
                ':priority' => (string) ($data['priority'] ?? 'medium'),
                ':notes' => (string) ($data['notes'] ?? ''),
                ':done' => !empty($data['done']) ? 1 : 0,
            ]);
            $row = $pdo->prepare('SELECT * FROM activities WHERE id = :id AND user_id = :user_id LIMIT 1');
            $row->execute([':id' => $activityId, ':user_id' => (int) $user['id']]);
            sendJson(201, ['success' => true, 'activity' => normalizeActivityRow($row->fetch() ?: [])]);
        }

        if ($method === 'PATCH' && ($segments[2] ?? '') === 'toggle') {
            $id = $segments[3] ?? '';
            $stmt = $pdo->prepare('SELECT * FROM activities WHERE id = :id AND user_id = :user_id LIMIT 1');
            $stmt->execute([':id' => $id, ':user_id' => (int) $user['id']]);
            $activity = $stmt->fetch();
            if (!$activity) {
                sendJson(404, ['success' => false, 'error' => 'Actividad no encontrada']);
            }
            $done = (int) !$activity['done'];
            $pdo->prepare('UPDATE activities SET done = :done WHERE id = :id AND user_id = :user_id')->execute([':done' => $done, ':id' => $id, ':user_id' => (int) $user['id']]);
            $activity['done'] = $done;
            sendJson(200, ['success' => true, 'activity' => normalizeActivityRow($activity)]);
        }

        if ($method === 'DELETE' && isset($segments[2])) {
            $id = $segments[2];
            $pdo->prepare('DELETE FROM activities WHERE id = :id AND user_id = :user_id')->execute([':id' => $id, ':user_id' => (int) $user['id']]);
            sendJson(200, ['success' => true, 'message' => 'Actividad eliminada']);
        }
    }

    if (($segments[1] ?? '') === 'timers') {
        $user = requireAuth();
        $pdo = getPdo();
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT *, date AS service_date, 4 AS target_hours, \'\' AS notes FROM service_timers WHERE user_id = :user_id ORDER BY date ASC');
            $stmt->execute([':user_id' => (int) $user['id']]);
            $rows = $stmt->fetchAll();
            $map = [];
            foreach ($rows as $row) {
                $map[$row['service_date']] = normalizeTimerRow($row);
            }
            sendJson(200, ['success' => true, 'timers' => $map]);
        }

        if ($method === 'POST') {
            $data = readJsonBody();
            $date = (string) ($data['date'] ?? date('Y-m-d'));
            $startAt = (float) ($data['startAt'] ?? time() * 1000);
            $userId = (int) $user['id'];
            $timerValues = [
                ':start_at' => $startAt,
                ':active_since' => isset($data['activeSince']) ? (float) $data['activeSince'] : $startAt,
                ':paused_at' => $data['pausedAt'] ?? null,
                ':elapsed_ms' => isset($data['elapsedMs']) ? max(0, (float) $data['elapsedMs']) : 0,
                ':end_at' => $data['endAt'] ?? null,
                ':hours_worked' => isset($data['hoursWorked']) ? (float) $data['hoursWorked'] : 0,
                ':notified' => !empty($data['notified']) ? 1 : 0,
            ];
            $existingTimer = $pdo->prepare('SELECT id FROM service_timers WHERE user_id = :user_id AND date = :date LIMIT 1');
            $existingTimer->execute([':user_id' => $userId, ':date' => $date]);
            $timerId = $existingTimer->fetchColumn();

            if ($timerId === false) {
                $pdo->prepare(
                    'INSERT INTO service_timers (user_id, date, start_at, active_since, paused_at, elapsed_ms, end_at, hours_worked, notified) VALUES (:user_id, :date, :start_at, :active_since, :paused_at, :elapsed_ms, :end_at, :hours_worked, :notified)'
                )->execute($timerValues + [':user_id' => $userId, ':date' => $date]);
            } else {
                $pdo->prepare(
                    'UPDATE service_timers SET start_at = :start_at, active_since = :active_since, paused_at = :paused_at, elapsed_ms = :elapsed_ms, end_at = :end_at, hours_worked = :hours_worked, notified = :notified WHERE id = :id AND user_id = :user_id'
                )->execute($timerValues + [':id' => (int) $timerId, ':user_id' => $userId]);
            }
            sendJson(201, ['success' => true, 'timer' => ['date' => $date]]);
        }

        if ($method === 'DELETE' && isset($segments[2])) {
            $date = $segments[2];
            $pdo->prepare('DELETE FROM service_timers WHERE user_id = :user_id AND date = :date')->execute([':user_id' => (int) $user['id'], ':date' => $date]);
            sendJson(200, ['success' => true, 'message' => 'Jornada reiniciada / eliminada']);
        }
    }

    if (($segments[1] ?? '') === 'settings') {
        $user = requireAuth();
        $pdo = getPdo();
        $key = $segments[2] ?? '';
        if (!in_array($key, ['theme', 'reflection'], true)) {
            sendJson(400, ['success' => false, 'error' => 'Ajuste no compatible con la base de datos']);
        }
        if ($method === 'GET') {
            $stmt = $pdo->prepare("SELECT {$key} AS setting_value FROM user_settings WHERE user_id = :user_id LIMIT 1");
            $stmt->execute([':user_id' => (int) $user['id']]);
            $row = $stmt->fetch();
            sendJson(200, ['success' => true, 'key' => $key, 'value' => $row ? $row['setting_value'] : null]);
        }
        if ($method === 'PUT') {
            $data = readJsonBody();
            $value = (string) ($data['value'] ?? '');
            if ($key === 'theme' && !in_array($value, ['light', 'dark'], true)) {
                sendJson(400, ['success' => false, 'error' => 'Tema no válido']);
            }
            $pdo->prepare("INSERT INTO user_settings (user_id, theme, reflection) VALUES (:user_id, 'dark', '') ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)")->execute([':user_id' => (int) $user['id']]);
            $pdo->prepare("UPDATE user_settings SET {$key} = :value WHERE user_id = :user_id")->execute([
                ':value' => $value,
                ':user_id' => (int) $user['id'],
            ]);
            sendJson(200, ['success' => true, 'setting' => ['user_id' => (int) $user['id'], 'key' => $key, 'value' => $value]]);
        }
    }

    if (($segments[1] ?? '') === 'goals') {
        $user = requireAuth();
        if ($method === 'GET') {
            sendJson(200, ['success' => true, 'goals' => ['dailyHours' => (float) $user['daily_hours'], 'weeklyHours' => (float) $user['weekly_hours'], 'totalHours' => (float) $user['total_hours'], 'institution' => $user['institution'], 'programName' => '']]);
        }
        if ($method === 'PUT') {
            $data = readJsonBody();
            $daily = isset($data['dailyHours']) ? (float) $data['dailyHours'] : (float) $user['daily_hours'];
            $weekly = isset($data['weeklyHours']) ? (float) $data['weeklyHours'] : (float) $user['weekly_hours'];
            $total = isset($data['totalHours']) ? (float) $data['totalHours'] : (float) $user['total_hours'];
            $pdo = getPdo();
            $pdo->prepare('UPDATE users SET daily_hours = :daily_hours, weekly_hours = :weekly_hours, total_hours = :total_hours WHERE id = :id')->execute([
                ':daily_hours' => $daily,
                ':weekly_hours' => $weekly,
                ':total_hours' => $total,
                ':id' => (int) $user['id'],
            ]);
            sendJson(200, ['success' => true, 'goals' => ['dailyHours' => $daily, 'weeklyHours' => $weekly, 'totalHours' => $total]]);
        }
    }

    if (($segments[1] ?? '') === 'reflections') {
        $user = requireAuth();
        $pdo = getPdo();
        if ($method === 'GET') {
            $stmt = $pdo->prepare('SELECT * FROM reflections WHERE user_id = :user_id ORDER BY date DESC, created_at DESC');
            $stmt->execute([':user_id' => (int) $user['id']]);
            $rows = $stmt->fetchAll();
            sendJson(200, ['success' => true, 'count' => count($rows), 'reflections' => $rows]);
        }
        if ($method === 'POST') {
            $data = readJsonBody();
            $content = trim((string) ($data['content'] ?? ''));
            if ($content === '') {
                sendJson(400, ['success' => false, 'error' => 'El contenido de la reflexión es obligatorio']);
            }
            $id = (string) ($data['id'] ?? ('ref-' . time() . '-' . bin2hex(random_bytes(4))));
            $pdo->prepare(
                'INSERT INTO reflections (id, user_id, date, title, content, category, hours_logged) VALUES (:id, :user_id, :date, :title, :content, :category, :hours_logged) ON DUPLICATE KEY UPDATE date = VALUES(date), title = VALUES(title), content = VALUES(content), category = VALUES(category), hours_logged = VALUES(hours_logged)'
            )->execute([
                ':id' => $id,
                ':user_id' => (int) $user['id'],
                ':date' => (string) ($data['date'] ?? date('Y-m-d')),
                ':title' => (string) ($data['title'] ?? 'Reflexión semanal'),
                ':content' => $content,
                ':category' => (string) ($data['category'] ?? 'General'),
                ':hours_logged' => (float) ($data['hoursLogged'] ?? 0),
            ]);
            $stmt = $pdo->prepare('SELECT * FROM reflections WHERE id = :id AND user_id = :user_id LIMIT 1');
            $stmt->execute([':id' => $id, ':user_id' => (int) $user['id']]);
            $reflection = $stmt->fetch();
            sendJson(201, ['success' => true, 'reflection' => $reflection]);
        }
        if ($method === 'DELETE' && isset($segments[2])) {
            $id = $segments[2];
            $pdo->prepare('DELETE FROM reflections WHERE id = :id AND user_id = :user_id')->execute([':id' => $id, ':user_id' => (int) $user['id']]);
            sendJson(200, ['success' => true, 'message' => 'Reflexión eliminada']);
        }
    }

    if (($segments[1] ?? '') === 'stats') {
        $user = requireAuth();
        $pdo = getPdo();
        $activitiesStmt = $pdo->prepare('SELECT * FROM activities WHERE user_id = :user_id');
        $activitiesStmt->execute([':user_id' => (int) $user['id']]);
        $activities = $activitiesStmt->fetchAll();
        $timersStmt = $pdo->prepare('SELECT * FROM service_timers WHERE user_id = :user_id');
        $timersStmt->execute([':user_id' => (int) $user['id']]);
        $timers = $timersStmt->fetchAll();

        $totalActivities = count($activities);
        $completed = 0;
        $totalHours = 0.0;
        foreach ($activities as $activity) {
            if (!empty($activity['done'])) {
                $completed++;
            }
            if (!empty($activity['done']) && $activity['start_time'] && $activity['end_time']) {
                $totalHours += max(0, (float) ((strtotime($activity['end_time']) - strtotime($activity['start_time'])) / 3600));
            }
        }

        $timerHours = 0.0;
        foreach ($timers as $timer) {
            $timerHours += (float) ($timer['hours_worked'] ?? 0);
        }

        sendJson(200, ['success' => true, 'stats' => [
            'totalActivities' => $totalActivities,
            'completedActivities' => $completed,
            'pendingActivities' => max(0, $totalActivities - $completed),
            'completionRate' => $totalActivities > 0 ? round(($completed / $totalActivities) * 100, 1) : 0,
            'totalActivityHours' => round($totalHours, 2),
            'totalTimerHours' => round($timerHours, 2),
            'totalImpactHours' => round($totalHours + $timerHours, 2),
            'activeDaysCount' => count(array_unique(array_column($activities, 'date'))),
            'categoryStats' => [],
            'goals' => ['dailyGoal' => (float) $user['daily_hours'], 'weeklyGoal' => (float) $user['weekly_hours'], 'totalGoal' => (float) $user['total_hours'], 'totalProgressPercent' => $user['total_hours'] > 0 ? round(($timerHours / (float) $user['total_hours']) * 100, 1) : 0],
        ]]);
    }

    sendJson(404, ['success' => false, 'error' => 'Endpoint no encontrado']);
}
