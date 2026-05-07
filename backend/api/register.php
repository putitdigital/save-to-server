<?php
/**
 * POST /api/register.php
 * Called once on first launch to register a new app installation.
 *
 * Body (JSON):
 * {
 *   "instance_id": "uuid-v4",
 *   "app_version": "1.0.0",
 *   "os": "macOS 14"
 * }
 *
 * Headers:
 *   X-Api-Key: <your API key>
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/helpers.php';
require_once __DIR__ . '/../config/db.php';

boot_api_request();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Method not allowed'], 405);
}

require_telemetry_auth();

$body = json_decode(file_get_contents('php://input'), true) ?? [];

$instance_id = trim($body['instance_id'] ?? '');
$app_version = trim($body['app_version'] ?? '');
$os          = trim($body['os'] ?? '');
$username    = sanitize_username($body['username'] ?? '');
$name        = normalize_name_field($body['name'] ?? '');
$surname     = normalize_name_field($body['surname'] ?? '');

// Validate instance_id is a UUID v4 pattern
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $instance_id)) {
    json_response(['error' => 'Invalid instance_id format'], 400);
}

try {
    $db = get_db();
    $user_id = upsert_user_and_get_id($db, $username, $name, $surname);

    // Upsert: insert if new, update last_seen_at if already registered
    $sql = 'INSERT INTO app_instances (instance_id, app_version, os, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                last_seen_at = NOW(),
                app_version  = VALUES(app_version),
                os           = VALUES(os)';

    $stmt = $db->prepare($sql);
    if (!$stmt) {
        throw new Exception('Failed to prepare register statement');
    }

    $stmt->bind_param('sss', $instance_id, $app_version, $os);
    if (!$stmt->execute()) {
        throw new Exception('Failed to execute register statement');
    }
    $stmt->close();

    if ($user_id !== null) {
        link_user_instance($db, $instance_id, $user_id);
    }

    json_response([
        'status' => 'ok',
        'user_id' => $user_id
    ]);

} catch (Throwable $e) {
    json_response(['error' => 'Server error'], 500);
}
