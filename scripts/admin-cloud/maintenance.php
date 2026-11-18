<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/runtime.php';
try {
    $db = cloudDb(cloudConfig());
    cloudQuery($db, 'DELETE FROM stech_admin_cloud_sessions WHERE expires_at<? LIMIT 1000', [time()]);
    cloudQuery($db, 'DELETE FROM stech_admin_cloud_attempts WHERE attempt_window<? LIMIT 1000', [intdiv(time(), 60)-120]);
} catch (Throwable $e) {
    fwrite(STDERR, "STech admin bakım bağlantısı başarısız.\n");
    exit(1);
}
