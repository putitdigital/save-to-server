<?php

require_once __DIR__ . '/config.php';

function get_db(): mysqli {
    static $db = null;

    if ($db !== null) {
        return $db;
    }

    if (!extension_loaded('mysqli')) {
        throw new Exception('mysqli extension is not enabled on this server');
    }

    $db = @new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, (int) DB_PORT);

    if ($db->connect_errno) {
        throw new Exception('MySQL connection failed: ' . $db->connect_error);
    }

    if (!$db->set_charset('utf8mb4')) {
        throw new Exception('Failed to set utf8mb4 charset');
    }

    return $db;
}
