<?php

/**
 * Shared helpers used by all API endpoints.
 */

require_once __DIR__ . '/config.php';

/**
 * Send API headers and short-circuit preflight requests.
 */
function boot_api_request(): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Api-Key, X-API-Key, X-Telemetry-Token');
    header('Vary: Origin');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/**
 * Best-effort header lookup across SAPIs.
 */
function get_request_header(string $headerName): string {
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $variants = [
        $headerName,
        strtolower($headerName),
        strtoupper($headerName)
    ];

    if (is_array($headers)) {
        foreach ($variants as $variant) {
            if (!empty($headers[$variant])) {
                return trim((string) $headers[$variant]);
            }
        }
    }

    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $headerName));
    $redirectKey = 'REDIRECT_' . $serverKey;

    if (!empty($_SERVER[$serverKey])) {
        return trim((string) $_SERVER[$serverKey]);
    }

    if (!empty($_SERVER[$redirectKey])) {
        return trim((string) $_SERVER[$redirectKey]);
    }

    return '';
}

function base64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function base64url_decode(string $value): string {
    $padding = strlen($value) % 4;
    if ($padding > 0) {
        $value .= str_repeat('=', 4 - $padding);
    }
    return base64_decode(strtr($value, '-_', '+/'), true) ?: '';
}

function telemetry_token_secret(): string {
    if (defined('TELEMETRY_TOKEN_SECRET') && trim((string) TELEMETRY_TOKEN_SECRET) !== '') {
        return (string) TELEMETRY_TOKEN_SECRET;
    }
    return (string) API_KEY;
}

function issue_telemetry_token(int $ttlSeconds = 600): array {
    $issuedAt = time();
    $expiresAt = $issuedAt + max($ttlSeconds, 60);
    $payload = [
        'iss' => 'flowit-api',
        'iat' => $issuedAt,
        'exp' => $expiresAt,
        'nonce' => bin2hex(random_bytes(8))
    ];

    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $encodedPayload = base64url_encode($payloadJson ?: '{}');
    $signature = hash_hmac('sha256', $encodedPayload, telemetry_token_secret(), true);
    $encodedSignature = base64url_encode($signature);

    return [
        'token' => $encodedPayload . '.' . $encodedSignature,
        'expires_at' => gmdate('c', $expiresAt)
    ];
}

function verify_telemetry_token(string $token): bool {
    if ($token === '' || strpos($token, '.') === false) {
        return false;
    }

    [$encodedPayload, $encodedSignature] = explode('.', $token, 2);
    if ($encodedPayload === '' || $encodedSignature === '') {
        return false;
    }

    $expected = base64url_encode(hash_hmac('sha256', $encodedPayload, telemetry_token_secret(), true));
    if (!hash_equals($expected, $encodedSignature)) {
        return false;
    }

    $payloadJson = base64url_decode($encodedPayload);
    if ($payloadJson === '') {
        return false;
    }

    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        return false;
    }

    $now = time();
    $exp = (int) ($payload['exp'] ?? 0);
    if ($exp <= $now) {
        return false;
    }

    return true;
}

/**
 * Validate the X-API-Key header.
 * Terminates with 401 if invalid.
 */
function require_api_key(): void {
    $key = get_request_header('X-Api-Key');

    if (!hash_equals(API_KEY, $key)) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

/**
 * Require either a valid short-lived telemetry token or API key fallback.
 */
function require_telemetry_auth(): void {
    $token = get_request_header('X-Telemetry-Token');
    if ($token !== '' && verify_telemetry_token($token)) {
        return;
    }

    $key = get_request_header('X-Api-Key');
    if ($key !== '' && hash_equals(API_KEY, $key)) {
        return;
    }

    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

/**
 * Return JSON response and exit.
 */
function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

/**
 * Validate that required POST fields are present.
 * Returns sanitized values or terminates with 400.
 */
function require_fields(array $fields): array {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $result = [];

    foreach ($fields as $field) {
        $value = trim($input[$field] ?? '');
        if ($value === '') {
            json_response(['error' => "Missing required field: $field"], 400);
        }
        $result[$field] = $value;
    }

    return $result;
}

/**
 * Get optional field from request body.
 */
function optional_field(array $input, string $field, string $default = ''): string {
    return trim($input[$field] ?? $default);
}

/**
 * Normalize a username for backend identity usage.
 */
function sanitize_username(?string $username): string {
    $value = strtolower(trim((string) ($username ?? '')));
    if ($value === '') {
        return '';
    }

    $value = preg_replace('/[^a-z0-9._@\-]/', '', $value) ?? '';
    return substr($value, 0, 120);
}

/**
 * Trim and length-limit display names.
 */
function normalize_name_field(?string $value): string {
    return substr(trim((string) ($value ?? '')), 0, 120);
}

/**
 * Upsert a user identity and return its numeric id.
 */
function upsert_user_and_get_id(mysqli $db, string $username, string $name = '', string $surname = ''): ?int {
    if ($username === '') {
        return null;
    }

    $insertSql = 'INSERT INTO users (username, name, surname, created_at, updated_at, last_seen_at)
                  VALUES (?, ?, ?, NOW(), NOW(), NOW())
                  ON DUPLICATE KEY UPDATE
                      name = IF(VALUES(name) <> "", VALUES(name), name),
                      surname = IF(VALUES(surname) <> "", VALUES(surname), surname),
                      updated_at = NOW(),
                      last_seen_at = NOW()';

    $insert = $db->prepare($insertSql);
    if (!$insert) {
        throw new Exception('Failed to prepare user upsert statement');
    }

    $insert->bind_param('sss', $username, $name, $surname);
    if (!$insert->execute()) {
        throw new Exception('Failed to execute user upsert statement');
    }
    $insert->close();

    $select = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    if (!$select) {
        throw new Exception('Failed to prepare user lookup statement');
    }

    $select->bind_param('s', $username);
    if (!$select->execute()) {
        throw new Exception('Failed to execute user lookup statement');
    }

    $result = $select->get_result();
    $row = $result ? $result->fetch_assoc() : null;
    $select->close();

    if (!$row || !isset($row['id'])) {
        return null;
    }

    return (int) $row['id'];
}

/**
 * Link an installation instance to a user account.
 */
function link_user_instance(mysqli $db, string $instanceId, int $userId): void {
    $sql = 'INSERT INTO user_instances (instance_id, user_id, first_seen_at, last_seen_at)
            VALUES (?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                last_seen_at = NOW()';

    $stmt = $db->prepare($sql);
    if (!$stmt) {
        throw new Exception('Failed to prepare user-instance link statement');
    }

    $stmt->bind_param('si', $instanceId, $userId);
    if (!$stmt->execute()) {
        throw new Exception('Failed to execute user-instance link statement');
    }
    $stmt->close();
}

/**
 * Resolve the most recently linked user for an instance.
 */
function resolve_user_id_for_instance(mysqli $db, string $instanceId): ?int {
    $sql = 'SELECT user_id
            FROM user_instances
            WHERE instance_id = ?
            ORDER BY last_seen_at DESC, id DESC
            LIMIT 1';

    $stmt = $db->prepare($sql);
    if (!$stmt) {
        throw new Exception('Failed to prepare user resolve statement');
    }

    $stmt->bind_param('s', $instanceId);
    if (!$stmt->execute()) {
        throw new Exception('Failed to execute user resolve statement');
    }

    $result = $stmt->get_result();
    $row = $result ? $result->fetch_assoc() : null;
    $stmt->close();

    if (!$row || !isset($row['user_id'])) {
        return null;
    }

    return (int) $row['user_id'];
}

/**
 * Link a telemetry event to a user identity.
 */
function link_event_user(mysqli $db, string $eventId, int $userId): void {
    $sql = 'INSERT INTO activity_event_users (event_id, user_id, linked_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                linked_at = NOW()';

    $stmt = $db->prepare($sql);
    if (!$stmt) {
        throw new Exception('Failed to prepare event-user link statement');
    }

    $stmt->bind_param('si', $eventId, $userId);
    if (!$stmt->execute()) {
        throw new Exception('Failed to execute event-user link statement');
    }
    $stmt->close();
}
