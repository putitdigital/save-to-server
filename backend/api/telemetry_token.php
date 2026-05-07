<?php
/**
 * GET /api/telemetry_token.php
 * Issues a short-lived signed token for telemetry ingestion.
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/helpers.php';

boot_api_request();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Method not allowed'], 405);
}

try {
    $issued = issue_telemetry_token(600);
    json_response([
        'status' => 'ok',
        'token' => $issued['token'],
        'expires_at' => $issued['expires_at']
    ]);
} catch (Throwable $e) {
    json_response(['error' => 'Unable to issue token'], 500);
}
