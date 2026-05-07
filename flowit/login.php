<?php

require_once __DIR__ . '/config/bootstrap.php';

if (is_logged_in()) {
    header('Location: index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $password = (string) ($_POST['password'] ?? '');

    if (dashboard_login($password)) {
        header('Location: index.php');
        exit;
    }

    $error = 'Invalid password';
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= h(APP_NAME) ?> - Login</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body class="login-body">
  <main class="login-card">
    <h1><?= h(APP_NAME) ?></h1>
    <p class="muted">Sign in to view live usage metrics.</p>

    <?php if ($error !== ''): ?>
      <div class="error-box"><?= h($error) ?></div>
    <?php endif; ?>

    <form method="post" autocomplete="off">
      <label for="password">Dashboard Password</label>
      <input id="password" name="password" type="password" required>
      <button type="submit">Sign In</button>
    </form>
  </main>
</body>
</html>
