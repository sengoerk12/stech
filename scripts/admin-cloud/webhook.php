<?php
declare(strict_types=1);
require __DIR__ . '/runtime.php';
require __DIR__ . '/odeal-notification.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new DomainException('not_found', 404);
    $config = cloudConfig();
    $type = basename(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '');
    if (empty($config['odeal_enabled']) || empty($config['odeal_device']) || empty($config['odeal_request_key']))
        throw new DomainException('webhook_not_configured', 503);
    $event = OdealNotification::verify($type, cloudBody(1048576), $_SERVER['HTTP_X_ODEAL_REQUEST_KEY'] ?? '', $config['odeal_request_key'], $config['odeal_device']);
    if ($event !== null) OdealNotification::persist(cloudDb($config), $event);
    cloudReply(200, ['received' => true]);
} catch (DomainException $e) {
    cloudReply($e->getCode() ?: 400, ['code' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('STech cloud webhook write failed: ' . get_class($e));
    cloudReply(503, ['code' => 'retry_notification']);
}
