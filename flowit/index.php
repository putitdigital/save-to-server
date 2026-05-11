<?php

require_once __DIR__ . '/config/bootstrap.php';
require_login();

$db = app_db();

if (empty($_SESSION['flowit_csrf_token'])) {
  $_SESSION['flowit_csrf_token'] = bin2hex(random_bytes(32));
}

$csrfToken = (string) $_SESSION['flowit_csrf_token'];
$showInstallations = (($_GET['view'] ?? '') === 'installations');
$allowedGraphRanges = [7, 14, 30];
$graphRange = (int) ($_GET['range'] ?? 14);
if (!in_array($graphRange, $allowedGraphRanges, true)) {
  $graphRange = 14;
}
$graphDaysBack = max(0, $graphRange - 1);

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

$installationHealthRows = [];
$latestKnownVersion = '';
$notifications = [];
$notificationCounts = ['high' => 0, 'medium' => 0, 'low' => 0];

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
    $issues = [];

    if ($lastSeenTs === 0) {
      $issues[] = ['severity' => 'high', 'title' => 'No heartbeat', 'detail' => 'Installation has never reported online activity.'];
    } elseif (($now - $lastSeenTs) > 86400) {
      $issues[] = ['severity' => 'high', 'title' => 'Offline >24h', 'detail' => 'Device has been offline for more than one day.'];
    } elseif (($now - $lastSeenTs) > 1800) {
      $issues[] = ['severity' => 'medium', 'title' => 'Offline >30m', 'detail' => 'Device has not checked in for more than 30 minutes.'];
    }

    if (!$desiredSyncEnabled) {
      $issues[] = ['severity' => 'medium', 'title' => 'Sync paused', 'detail' => 'Sync is currently stopped by dashboard override.'];
    }

    if ($lastStartedTs > 0 && $lastStartedTs > $lastCompletedTs && ($now - $lastStartedTs) > 900) {
      $issues[] = ['severity' => 'high', 'title' => 'Sync may be stuck', 'detail' => 'Last sync_started has no matching sync_completed for over 15 minutes.'];
    }

    if (trim((string) ($row['usernames'] ?? '')) === '') {
      $issues[] = ['severity' => 'medium', 'title' => 'No user linked', 'detail' => 'No user identity is linked to this installation yet.'];
    }

    $rawVersion = trim((string) ($row['app_version'] ?? ''));
    $normalizedVersion = ltrim($rawVersion, 'vV');
    if ($normalizedVersion !== '' && preg_match('/^[0-9]+(\.[0-9]+)*$/', $normalizedVersion)) {
      if ($latestKnownVersion === '' || version_compare($normalizedVersion, $latestKnownVersion, '>')) {
        $latestKnownVersion = $normalizedVersion;
      }
    } else {
      $issues[] = ['severity' => 'medium', 'title' => 'Missing app version', 'detail' => 'Installation is not reporting a valid app version.'];
    }

    $row['is_online'] = $isOnline;
    $row['is_syncing'] = $isSyncing;
    $row['desired_sync_enabled'] = $desiredSyncEnabled;
    $row['normalized_version'] = $normalizedVersion;
    $row['issues'] = $issues;
    $installationHealthRows[] = $row;
  }
}

foreach ($installationHealthRows as &$installRow) {
  $normalizedVersion = (string) ($installRow['normalized_version'] ?? '');
  if ($latestKnownVersion !== '' && $normalizedVersion !== '' && preg_match('/^[0-9]+(\.[0-9]+)*$/', $normalizedVersion) && version_compare($normalizedVersion, $latestKnownVersion, '<')) {
    $installRow['issues'][] = [
      'severity' => 'high',
      'title' => 'Outdated app version',
      'detail' => 'Running ' . $normalizedVersion . ' while latest is ' . $latestKnownVersion . '.'
    ];
  }

  foreach ($installRow['issues'] as $issue) {
    $severity = (string) ($issue['severity'] ?? 'low');
    if (!isset($notificationCounts[$severity])) {
      $notificationCounts[$severity] = 0;
    }
    $notificationCounts[$severity]++;

    $notifications[] = [
      'severity' => $severity,
      'instance_id' => (string) ($installRow['instance_id'] ?? ''),
      'title' => (string) ($issue['title'] ?? 'Issue detected'),
      'detail' => (string) ($issue['detail'] ?? ''),
      'last_seen_at' => (string) ($installRow['last_seen_at'] ?? '')
    ];
  }
}
unset($installRow);

usort($notifications, static function (array $a, array $b): int {
  $weights = ['high' => 3, 'medium' => 2, 'low' => 1];
  $aWeight = $weights[$a['severity'] ?? 'low'] ?? 1;
  $bWeight = $weights[$b['severity'] ?? 'low'] ?? 1;

  if ($aWeight !== $bWeight) {
    return $bWeight <=> $aWeight;
  }

  return strcmp((string) ($b['last_seen_at'] ?? ''), (string) ($a['last_seen_at'] ?? ''));
});

$dailyActivity = [];
for ($i = $graphDaysBack; $i >= 0; $i--) {
  $dateKey = date('Y-m-d', strtotime('-' . $i . ' days'));
  $dailyActivity[$dateKey] = [
    'day' => $dateKey,
    'label' => date('M j', strtotime($dateKey)),
    'total_events' => 0,
    'sync_completed' => 0,
    'active_installations' => 0,
  ];
}

$dailySql = "SELECT DATE(event_time) AS day,
                    COUNT(*) AS total_events,
                    SUM(CASE WHEN event_type = 'sync_completed' THEN 1 ELSE 0 END) AS sync_completed,
                    COUNT(DISTINCT instance_id) AS active_installations
               FROM activity_events
              WHERE event_time >= (CURDATE() - INTERVAL {$graphDaysBack} DAY)
              GROUP BY DATE(event_time)
              ORDER BY day ASC";
if ($dailyResult = $db->query($dailySql)) {
  while ($row = $dailyResult->fetch_assoc()) {
    $day = (string) ($row['day'] ?? '');
    if (isset($dailyActivity[$day])) {
      $dailyActivity[$day]['total_events'] = (int) ($row['total_events'] ?? 0);
      $dailyActivity[$day]['sync_completed'] = (int) ($row['sync_completed'] ?? 0);
      $dailyActivity[$day]['active_installations'] = (int) ($row['active_installations'] ?? 0);
    }
  }
}
$dailyActivity = array_values($dailyActivity);
$dailyEventsMax = 1;
foreach ($dailyActivity as $dayRow) {
  $dailyEventsMax = max($dailyEventsMax, (int) ($dayRow['total_events'] ?? 0));
}

$eventMix = [];
$eventMixTotal = 0;
$eventMixSql = "SELECT event_type, COUNT(*) AS total
                  FROM activity_events
                 WHERE event_time >= (NOW() - INTERVAL {$graphRange} DAY)
                 GROUP BY event_type
                 ORDER BY total DESC";
if ($eventMixResult = $db->query($eventMixSql)) {
  while ($row = $eventMixResult->fetch_assoc()) {
    $count = (int) ($row['total'] ?? 0);
    $eventMix[] = [
      'event_type' => (string) ($row['event_type'] ?? 'unknown'),
      'total' => $count,
    ];
    $eventMixTotal += $count;
  }
}

$healthBuckets = [
  'healthy' => 0,
  'warning' => 0,
  'critical' => 0,
];
foreach ($installationHealthRows as $installRow) {
  $highestSeverity = 'low';
  foreach (($installRow['issues'] ?? []) as $issue) {
    $severity = (string) ($issue['severity'] ?? 'low');
    if ($severity === 'high') {
      $highestSeverity = 'high';
      break;
    }
    if ($severity === 'medium' && $highestSeverity !== 'high') {
      $highestSeverity = 'medium';
    }
  }

  if ($highestSeverity === 'high') {
    $healthBuckets['critical']++;
  } elseif ($highestSeverity === 'medium') {
    $healthBuckets['warning']++;
  } else {
    $healthBuckets['healthy']++;
  }
}
$healthTotal = max(1, array_sum($healthBuckets));

$installations = $showInstallations ? $installationHealthRows : [];
$lastRefreshed = date('Y-m-d H:i:s');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title><?= h(APP_NAME) ?></title>
  <link rel="icon" type="image/png" href="assets/icon.ico" sizes="16x16" />
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
    <section class="graph-section" id="graphs">
      <article class="panel chart-card">
        <div class="panel-head">
          <h2>Activity Trend (<?= number_format($graphRange) ?> Days)</h2>
          <div class="chart-controls">
            <?php foreach ($allowedGraphRanges as $rangeOption): ?>
              <?php
                $rangeQuery = ['range' => $rangeOption];
                if ($showInstallations) {
                  $rangeQuery['view'] = 'installations';
                }
              ?>
              <a class="chart-range-pill <?= $graphRange === $rangeOption ? 'range-active' : '' ?>" href="?<?= h(http_build_query($rangeQuery)) ?>#graphs">
                <?= number_format($rangeOption) ?>d
              </a>
            <?php endforeach; ?>
          </div>
        </div>
        <div class="trend-bars" style="grid-template-columns: repeat(<?= max(1, count($dailyActivity)) ?>, minmax(0, 1fr));">
          <?php foreach ($dailyActivity as $dayRow): ?>
            <?php
              $events = (int) ($dayRow['total_events'] ?? 0);
              $syncCompleted = (int) ($dayRow['sync_completed'] ?? 0);
              $activeInstalls = (int) ($dayRow['active_installations'] ?? 0);
              $heightPct = (int) round(($events / $dailyEventsMax) * 100);
            ?>
            <div class="trend-day" title="<?= h((string) ($dayRow['label'] ?? '')) ?>: <?= number_format($events) ?> events, <?= number_format($syncCompleted) ?> sync completed, <?= number_format($activeInstalls) ?> active installs">
              <div class="trend-bar-wrap">
                <div class="trend-bar" style="height: <?= max(6, $heightPct) ?>%"></div>
              </div>
              <p class="trend-label"><?= h((string) ($dayRow['label'] ?? '')) ?></p>
            </div>
          <?php endforeach; ?>
        </div>
      </article>

      <article class="panel chart-card">
        <div class="panel-head">
          <h2>Event Mix (<?= number_format($graphRange) ?> Days)</h2>
          <span class="muted"><?= number_format($eventMixTotal) ?> total events</span>
        </div>
        <?php if (count($eventMix) === 0): ?>
          <p class="muted">No event data available yet.</p>
        <?php else: ?>
          <div class="event-mix-list">
            <?php foreach (array_slice($eventMix, 0, 8) as $mixRow): ?>
              <?php
                $mixCount = (int) ($mixRow['total'] ?? 0);
                $mixPct = $eventMixTotal > 0 ? ($mixCount / $eventMixTotal) * 100 : 0;
              ?>
              <div class="event-mix-row">
                <p class="event-mix-label"><?= h((string) ($mixRow['event_type'] ?? 'unknown')) ?></p>
                <div class="event-mix-track">
                  <div class="event-mix-fill" style="width: <?= max(3, (int) round($mixPct)) ?>%"></div>
                </div>
                <p class="event-mix-value"><?= number_format($mixCount) ?> (<?= number_format($mixPct, 1) ?>%)</p>
              </div>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>
      </article>

      <article class="panel chart-card">
        <div class="panel-head">
          <h2>Installation Health</h2>
          <span class="muted"><?= number_format(array_sum($healthBuckets)) ?> installations</span>
        </div>
        <div class="health-stack" aria-label="Installation health breakdown">
          <span class="health-segment health-good" style="width: <?= (int) round(($healthBuckets['healthy'] / $healthTotal) * 100) ?>%"></span>
          <span class="health-segment health-warn" style="width: <?= (int) round(($healthBuckets['warning'] / $healthTotal) * 100) ?>%"></span>
          <span class="health-segment health-critical" style="width: <?= (int) round(($healthBuckets['critical'] / $healthTotal) * 100) ?>%"></span>
        </div>
        <div class="health-legend">
          <p><span class="health-dot health-good"></span>Healthy: <?= number_format($healthBuckets['healthy']) ?></p>
          <p><span class="health-dot health-warn"></span>Warning: <?= number_format($healthBuckets['warning']) ?></p>
          <p><span class="health-dot health-critical"></span>Critical: <?= number_format($healthBuckets['critical']) ?></p>
        </div>
      </article>
    </section>

    <div class="dashboard-layout">
      <div class="dashboard-main">
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
                    $installIssues = $install['issues'] ?? [];

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
                  <article class="install-card" id="install-<?= h((string) ($install['instance_id'] ?? '')) ?>">
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

                    <?php if (count($installIssues) > 0): ?>
                      <div class="issue-list">
                        <?php foreach ($installIssues as $issue): ?>
                          <p class="issue-pill issue-<?= h((string) ($issue['severity'] ?? 'low')) ?>">
                            <?= h((string) ($issue['title'] ?? 'Issue')) ?>
                          </p>
                        <?php endforeach; ?>
                      </div>
                    <?php endif; ?>

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
      </div>

      <aside class="dashboard-aside">
        <section class="panel notification-panel">
          <div class="panel-head">
            <h2>Install Notifications</h2>
            <a href="?view=installations#installations">View devices</a>
          </div>

          <div class="notification-counts">
            <p class="issue-pill issue-high">High: <?= number_format((int) ($notificationCounts['high'] ?? 0)) ?></p>
            <p class="issue-pill issue-medium">Medium: <?= number_format((int) ($notificationCounts['medium'] ?? 0)) ?></p>
            <p class="issue-pill issue-low">Info: <?= number_format((int) ($notificationCounts['low'] ?? 0)) ?></p>
          </div>

          <?php if (count($notifications) === 0): ?>
            <p class="muted">No current installation vulnerabilities detected.</p>
          <?php else: ?>
            <div class="notification-list">
              <?php foreach (array_slice($notifications, 0, 20) as $notification): ?>
                <article class="notification-item severity-<?= h((string) ($notification['severity'] ?? 'low')) ?>">
                  <h3><?= h((string) ($notification['title'] ?? 'Issue')) ?></h3>
                  <p class="notification-detail"><?= h((string) ($notification['detail'] ?? '')) ?></p>
                  <p class="notification-meta">Instance: <?= h((string) ($notification['instance_id'] ?? '')) ?></p>
                  <p class="notification-meta">Last seen: <?= h((string) ($notification['last_seen_at'] ?? 'N/A')) ?></p>
                </article>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </section>
      </aside>
    </div>
  </main>
</body>
</html>
