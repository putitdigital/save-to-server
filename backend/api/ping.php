<?php
/**
 * GET /api/ping.php
 * Health check — verifies PHP and MySQL are reachable.
 * No API key required so you can test from a browser.
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/helpers.php';
require_once __DIR__ . '/../config/db.php';

boot_api_request();

try {
    $db = get_db();
    if (!$db->query('SELECT 1')) {
        throw new Exception('Health query failed');
    }
    echo json_encode([
        'status' => 'ok',
        'db'     => 'connected',
        'time'   => date('c'),
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'db'     => 'unreachable',
        'detail' => $e->getMessage(),
    ]);
}
