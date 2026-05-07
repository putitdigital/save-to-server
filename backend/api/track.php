<?php
/**
 * POST /api/track.php
 * Records a telemetry event from the desktop app.
 *
 * Body (JSON):
 * {
 *   "event_id":    "uuid-v4",       -- unique per event, for deduplication
 *   "instance_id": "uuid-v4",       -- identifies the installation
 *   "event_type":  "sync_completed",-- app_open | sync_started | sync_completed | heartbeat
 *   "app_version": "1.0.0",
 *   "os":          "macOS 14",
 *   "metadata":    {}               -- optional extra data
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

$event_id    = trim($body['event_id']    ?? '');
$instance_id = trim($body['instance_id'] ?? '');
$event_type  = trim($body['event_type']  ?? '');
$app_version = trim($body['app_version'] ?? '');
$os          = trim($body['os']          ?? '');
$metadata    = $body['metadata'] ?? null;
$username    = sanitize_username($body['username'] ?? '');
$name        = normalize_name_field($body['name'] ?? '');
$surname     = normalize_name_field($body['surname'] ?? '');

// Validate UUIDs
$uuid_pattern = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
if (!preg_match($uuid_pattern, $event_id) || !preg_match($uuid_pattern, $instance_id)) {
    json_response(['error' => 'Invalid UUID format'], 400);
}

// Whitelist allowed event types to prevent arbitrary data injection
$allowed_events = ['app_open', 'sync_started', 'sync_completed', 'sync_failed', 'heartbeat'];
if (!in_array($event_type, $allowed_events, true)) {
    json_response(['error' => 'Invalid event_type'], 400);
}

try {
    $db = get_db();
    $user_id = null;
    if ($username !== '') {
        $user_id = upsert_user_and_get_id($db, $username, $name, $surname);
    }

    if ($user_id === null) {
        $user_id = resolve_user_id_for_instance($db, $instance_id);
    }

    $metadata_json = $metadata !== null
        ? json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        : null;

    // Insert event — ignore duplicates (idempotent)
    $sql = 'INSERT INTO activity_events
                (event_id, instance_id, event_type, app_version, os, metadata, event_time)
            VALUES
                (?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE id = id';

    $stmt = $db->prepare($sql);
    if (!$stmt) {
        throw new Exception('Failed to prepare track insert statement');
    }

    $stmt->bind_param('ssssss', $event_id, $instance_id, $event_type, $app_version, $os, $metadata_json);
    if (!$stmt->execute()) {
        throw new Exception('Failed to execute track insert statement');
    }
    $stmt->close();

    // Keep last_seen_at fresh on app_instances
    $update = $db->prepare('UPDATE app_instances SET last_seen_at = NOW() WHERE instance_id = ?');
    if (!$update) {
        throw new Exception('Failed to prepare track update statement');
    }

    $update->bind_param('s', $instance_id);
    if (!$update->execute()) {
        throw new Exception('Failed to execute track update statement');
    }
    $update->close();

    if ($user_id !== null) {
        link_user_instance($db, $instance_id, $user_id);
        link_event_user($db, $event_id, $user_id);
    }

    json_response([
        'status' => 'ok',
        'user_id' => $user_id
    ]);

} catch (Throwable $e) {
    json_response(['error' => 'Server error'], 500);
}
