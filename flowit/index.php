<?php

require_once __DIR__ . '/config/bootstrap.php';
require_login();

$db = app_db();

if (empty($_SESSION['flowit_csrf_token'])) {
  $_SESSION['flowit_csrf_token'] = bin2hex(random_bytes(32));
}

$csrfToken = (string) $_SESSION['flowit_csrf_token'];
$showInstallations = (($_GET['view'] ?? '') === 'installations');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $postedToken = (string) ($_POST['csrf_token'] ?? '');
  $instanceId = trim((string) ($_POST['instance_id'] ?? ''));
  $syncAction = (string) ($_POST['sync_action'] ?? '');

  if (!hash_equals($csrfToken, $postedToken)) {
    $_SESSION['flowit_flash_error'] = 'Security check failed. Please try again.';
  } elseif (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $instanceId)) {
    $_SESSION['flowit_flash_error'] = 'Invalid installation identifier.';
  } elseif (!in_array($syncAction, ['start', 'stop'], true)) {
    $_SESSION['flowit_flash_error'] = 'Unknown sync action.';
  } else {
    $desiredSync = $syncAction === 'start' ? 1 : 0;
    $stmt = $db->prepare('UPDATE app_instances SET desired_sync_enabled = ?, sync_override_updated_at = NOW() WHERE instance_id = ? LIMIT 1');

    if ($stmt) {
      $stmt->bind_param('is', $desiredSync, $instanceId);
      $stmt->execute();
      $stmt->close();

      if ($db->affected_rows >= 0) {
        $_SESSION['flowit_flash_success'] = $syncAction === 'start'
          ? 'Sync start requested for installation ' . $instanceId
          : 'Sync stop requested for installation ' . $instanceId;
      }
    } else {
      $_SESSION['flowit_flash_error'] = 'Unable to update installation state right now.';
    }
  }

  header('Location: index.php?view=installations#installations');
  exit;
}

$flashError = (string) ($_SESSION['flowit_flash_error'] ?? '');
$flashSuccess = (string) ($_SESSION['flowit_flash_success'] ?? '');
unset($_SESSION['flowit_flash_error'], $_SESSION['flowit_flash_success']);

$stats = [
    'total_named_users' => q_scalar($db, 'SELECT COUNT(*) FROM users'),
    'total_installations' => q_scalar($db, 'SELECT COUNT(*) FROM app_instances'),
    'events_today' => q_scalar($db, 'SELECT COUNT(*) FROM activity_events WHERE DATE(event_time) = CURDATE()'),
    'active_users_today' => q_scalar(
        $db,
        'SELECT COUNT(DISTINCT aeu.user_id)
         FROM activity_event_users aeu
         INNER JOIN activity_events ae ON ae.event_id = aeu.event_id
         WHERE DATE(ae.event_time) = CURDATE()'
    ),
    'active_users_30d' => q_scalar(
        $db,
        'SELECT COUNT(DISTINCT aeu.user_id)
         FROM activity_event_users aeu
         INNER JOIN activity_events ae ON ae.event_id = aeu.event_id
         WHERE ae.event_time >= (NOW() - INTERVAL 30 DAY)'
    ),
    'sync_completed_30d' => q_scalar(
        $db,
        "SELECT COUNT(*) FROM activity_events WHERE event_type = 'sync_completed' AND event_time >= (NOW() - INTERVAL 30 DAY)"
    )
];

$recentUsers = [];
$userSql = 'SELECT u.username,
                   MAX(ae.event_time) AS last_activity,
                   COUNT(*) AS event_count
            FROM users u
            LEFT JOIN activity_event_users aeu ON aeu.user_id = u.id
            LEFT JOIN activity_events ae ON ae.event_id = aeu.event_id
            GROUP BY u.id, u.username
            ORDER BY last_activity DESC
            LIMIT 15';

if ($userResult = $db->query($userSql)) {
    while ($row = $userResult->fetch_assoc()) {
        $recentUsers[] = $row;
    }
}

$recentEvents = [];
$eventSql = "SELECT ae.event_time,
                    ae.event_type,
                    ai.instance_id,
                    u.username
             FROM activity_events ae
             LEFT JOIN activity_event_users aeu ON aeu.event_id = ae.event_id
             LEFT JOIN users u ON u.id = aeu.user_id
             LEFT JOIN app_instances ai ON ai.instance_id = ae.instance_id
             ORDER BY ae.event_time DESC
             LIMIT 30";
if ($eventResult = $db->query($eventSql)) {
    while ($row = $eventResult->fetch_assoc()) {
        $recentEvents[] = $row;
    }
}

$installations = [];
if ($showInstallations) {
  $installSql = "SELECT ai.instance_id,
              ai.app_version,
              ai.os,
              ai.first_seen_at,
              ai.last_seen_at,
              COALESCE(ai.desired_sync_enabled, 1) AS desired_sync_enabled,
              MAX(CASE WHEN ae.event_type = 'sync_started' THEN ae.event_time END) AS last_sync_started_at,
              MAX(CASE WHEN ae.event_type = 'sync_completed' THEN ae.event_time END) AS last_sync_completed_at,
              GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS usernames
           FROM app_instances ai
           LEFT JOIN activity_events ae ON ae.instance_id = ai.instance_id
           LEFT JOIN user_instances ui ON ui.instance_id = ai.instance_id
           LEFT JOIN users u ON u.id = ui.user_id
           GROUP BY ai.instance_id, ai.app_version, ai.os, ai.first_seen_at, ai.last_seen_at, ai.desired_sync_enabled
           ORDER BY ai.last_seen_at DESC";

  if ($installResult = $db->query($installSql)) {
    $now = time();
    while ($row = $installResult->fetch_assoc()) {
      $lastSeenTs = strtotime((string) ($row['last_seen_at'] ?? '')) ?: 0;
      $lastStartedTs = strtotime((string) ($row['last_sync_started_at'] ?? '')) ?: 0;
      $lastCompletedTs = strtotime((string) ($row['last_sync_completed_at'] ?? '')) ?: 0;
      $isOnline = $lastSeenTs > 0 && ($now - $lastSeenTs) <= 300;
      $isSyncing = $isOnline && $lastStartedTs > 0 && ($lastCompletedTs === 0 || $lastStartedTs > $lastCompletedTs);
      $desiredSyncEnabled = ((int) ($row['desired_sync_enabled'] ?? 1)) === 1;

      $row['is_online'] = $isOnline;
      $row['is_syncing'] = $isSyncing;
      $row['desired_sync_enabled'] = $desiredSyncEnabled;
      $installations[] = $row;
    }
  }
}

$lastRefreshed = date('Y-m-d H:i:s');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title><?= h(APP_NAME) ?></title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <main class="dashboard">
    <header class="topbar">
      <div>
        <h1><?= h(APP_NAME) ?></h1>
        <p class="muted">Live monitoring for Flowit usage and sync activity.</p>
      </div>
      <div>
        <a href="logout.php">Sign out</a>
      </div>
    </header>

    <section class="stats-grid">
      <article class="stat-card">
        <p class="stat-label">Named Users</p>
        <p class="stat-value"><?= number_format($stats['total_named_users']) ?></p>
      </article>
      <a class="stat-card stat-card-link" href="?view=installations#installations">
        <p class="stat-label">Installations</p>
        <p class="stat-value"><?= number_format($stats['total_installations']) ?></p>
      </a>
      <article class="stat-card">
        <p class="stat-label">Events Today</p>
        <p class="stat-value"><?= number_format($stats['events_today']) ?></p>
      </article>
      <article class="stat-card">
        <p class="stat-label">DAU (Named)</p>
        <p class="stat-value"><?= number_format($stats['active_users_today']) ?></p>
      </article>
      <article class="stat-card">
        <p class="stat-label">MAU 30d (Named)</p>
        <p class="stat-value"><?= number_format($stats['active_users_30d']) ?></p>
      </article>
      <article class="stat-card">
        <p class="stat-label">Sync Completed 30d</p>
        <p class="stat-value"><?= number_format($stats['sync_completed_30d']) ?></p>
      </article>
    </section>

    <?php if ($showInstallations): ?>
      <section class="panel" id="installations">
        <div class="panel-head">
          <h2>Installed Devices</h2>
          <a href="index.php">Hide</a>
        </div>

        <?php if ($flashError !== ''): ?>
          <div class="error-box"><?= h($flashError) ?></div>
        <?php endif; ?>
        <?php if ($flashSuccess !== ''): ?>
          <div class="success-box"><?= h($flashSuccess) ?></div>
        <?php endif; ?>

        <div class="install-grid">
          <?php if (count($installations) === 0): ?>
            <p class="muted">No installations found yet.</p>
          <?php else: ?>
            <?php foreach ($installations as $install): ?>
              <?php
                $isOnline = (bool) ($install['is_online'] ?? false);
                $isSyncing = (bool) ($install['is_syncing'] ?? false);
                $desiredSyncEnabled = (bool) ($install['desired_sync_enabled'] ?? true);

                $syncSummary = 'Idle';
                if (!$desiredSyncEnabled) {
                    $syncSummary = 'Stopped by dashboard';
                } elseif ($isSyncing) {
                    $syncSummary = 'Currently syncing';
                } elseif ($isOnline) {
                    $syncSummary = 'Online, waiting for next sync';
                } else {
                    $syncSummary = 'Offline';
                }

                $syncButtonAction = $desiredSyncEnabled ? 'stop' : 'start';
                $syncButtonLabel = $desiredSyncEnabled ? 'Stop Sync' : 'Start Sync';
              ?>
              <article class="install-card">
                <div class="install-card-head">
                  <h3><?= h((string) ($install['instance_id'] ?? '')) ?></h3>
                  <span class="status-badge <?= $isOnline ? 'status-online' : 'status-offline' ?>">
                    <?= $isOnline ? 'Online' : 'Offline' ?>
                  </span>
                </div>
                <p class="muted install-sync-state">Sync state: <?= h($syncSummary) ?></p>
                <p class="install-meta">App: <?= h((string) ($install['app_version'] ?? 'N/A')) ?></p>
                <p class="install-meta">OS: <?= h((string) ($install['os'] ?? 'N/A')) ?></p>
                <p class="install-meta">Users: <?= h((string) ($install['usernames'] ?? 'N/A')) ?></p>
                <p class="install-meta">First seen: <?= h((string) ($install['first_seen_at'] ?? 'N/A')) ?></p>
                <p class="install-meta">
                  <?= $isOnline ? 'Last heartbeat' : 'Last online' ?>:
                  <?= h((string) ($install['last_seen_at'] ?? 'N/A')) ?>
                </p>

                <form class="sync-form" method="post" action="?view=installations#installations">
                  <input type="hidden" name="csrf_token" value="<?= h($csrfToken) ?>">
                  <input type="hidden" name="instance_id" value="<?= h((string) ($install['instance_id'] ?? '')) ?>">
                  <input type="hidden" name="sync_action" value="<?= h($syncButtonAction) ?>">
                  <button type="submit" class="sync-toggle <?= $desiredSyncEnabled ? 'sync-stop' : 'sync-start' ?>">
                    <?= h($syncButtonLabel) ?>
                  </button>
                </form>
              </article>
            <?php endforeach; ?>
          <?php endif; ?>
        </div>
      </section>
    <?php endif; ?>

    <section class="panel">
      <h2>Recent Users</h2>
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Last Activity</th>
            <th>Total Linked Events</th>
          </tr>
        </thead>
        <tbody>
          <?php if (count($recentUsers) === 0): ?>
            <tr><td colspan="3">No user data yet.</td></tr>
          <?php else: ?>
            <?php foreach ($recentUsers as $user): ?>
              <tr>
                <td><?= h((string) ($user['username'] ?? '')) ?></td>
                <td><?= h((string) ($user['last_activity'] ?? 'N/A')) ?></td>
                <td><?= number_format((int) ($user['event_count'] ?? 0)) ?></td>
              </tr>
            <?php endforeach; ?>
          <?php endif; ?>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Recent Events</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Username</th>
            <th>Instance</th>
          </tr>
        </thead>
        <tbody>
          <?php if (count($recentEvents) === 0): ?>
            <tr><td colspan="4">No events found.</td></tr>
          <?php else: ?>
            <?php foreach ($recentEvents as $event): ?>
              <tr>
                <td><?= h((string) ($event['event_time'] ?? '')) ?></td>
                <td><?= h((string) ($event['event_type'] ?? '')) ?></td>
                <td><?= h((string) ($event['username'] ?? 'N/A')) ?></td>
                <td><?= h((string) ($event['instance_id'] ?? '')) ?></td>
              </tr>
            <?php endforeach; ?>
          <?php endif; ?>
        </tbody>
      </table>
    </section>

    <p class="muted">Auto refresh every 60s. Last refreshed: <?= h($lastRefreshed) ?></p>
  </main>
</body>
</html>
