<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
?>
<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="stech-hosted-admin" content="1" />
  <meta name="stech-cloud-admin" content="1" />
  <title>S TECH · Yönetim</title>
  <link rel="stylesheet" href="./style.css" />
  <script src="./app.js" defer></script>
</head>
<body>
  <div id="app"><div class="loading">S TECH yönetimi hazırlanıyor…</div></div>
  <div id="toast" role="status" aria-live="polite"></div>
  <dialog id="modal"></dialog>
</body>
</html>
