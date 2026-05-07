<?php

require_once __DIR__ . '/config/bootstrap.php';

dashboard_logout();
header('Location: login.php');
exit;
