<?php

require_once __DIR__ . '/config/bootstrap.php';
require_login();

$db = app_db();

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
      <article class="stat-card">
        <p class="stat-label">Installations</p>
        <p class="stat-value"><?= number_format($stats['total_installations']) ?></p>
      </article>
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
