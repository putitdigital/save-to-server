<?php

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

$configCandidates = [];

$configFromEnv = trim((string) getenv('FLOWIT_DASHBOARD_CONFIG'));
if ($configFromEnv !== '') {
    $configCandidates[] = $configFromEnv;
}

$configCandidates[] = __DIR__ . '/config.php';
$configCandidates[] = dirname(__DIR__, 2) . '/flowit-api/config/config.php';
$configCandidates[] = dirname(__DIR__, 3) . '/flowit-api/config/config.php';

$loadedConfigPath = null;
foreach ($configCandidates as $candidate) {
    if (is_readable($candidate)) {
        require_once $candidate;
        $loadedConfigPath = $candidate;
        break;
    }
}

if ($loadedConfigPath === null) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "Flowit dashboard configuration not found.\n";
    echo "Checked paths:\n";
    foreach ($configCandidates as $candidate) {
        echo '- ' . $candidate . "\n";
    }
    exit;
}

if (!defined('APP_NAME')) {
    define('APP_NAME', 'Flowit Analytics');
}

if (!defined('APP_BASE_PATH')) {
    define('APP_BASE_PATH', '/flowit');
}

if (!defined('APP_TIMEZONE')) {
    define('APP_TIMEZONE', 'UTC');
}

if (!defined('DASHBOARD_PASSWORD_HASH')) {
    define('DASHBOARD_PASSWORD_HASH', 'REPLACE_WITH_PASSWORD_HASH');
}

date_default_timezone_set(APP_TIMEZONE);

function app_db(): mysqli {
    static $db = null;

    if ($db instanceof mysqli) {
        return $db;
    }

    if (!extension_loaded('mysqli')) {
        throw new RuntimeException('mysqli extension is not enabled');
    }

    $db = @new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, (int) DB_PORT);
    if ($db->connect_errno) {
        throw new RuntimeException('DB connection failed: ' . $db->connect_error);
    }

    if (!$db->set_charset('utf8mb4')) {
        throw new RuntimeException('Unable to set utf8mb4 charset');
    }

    return $db;
}

function is_logged_in(): bool {
    return !empty($_SESSION['flowit_dashboard_auth']);
}

function require_login(): void {
    if (!is_logged_in()) {
        header('Location: login.php');
        exit;
    }
}

function dashboard_login(string $password): bool {
    if (!defined('DASHBOARD_PASSWORD_HASH') || DASHBOARD_PASSWORD_HASH === 'REPLACE_WITH_PASSWORD_HASH') {
        return false;
    }

    if (!password_verify($password, DASHBOARD_PASSWORD_HASH)) {
        return false;
    }

    $_SESSION['flowit_dashboard_auth'] = true;
    $_SESSION['flowit_dashboard_login_at'] = time();
    return true;
}

function dashboard_logout(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
}

function q_scalar(mysqli $db, string $sql): int {
    $result = $db->query($sql);
    if (!$result) {
        return 0;
    }

    $row = $result->fetch_row();
    return (int) ($row[0] ?? 0);
}

function h(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
