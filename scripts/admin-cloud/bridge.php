<?php
declare(strict_types=1);
require __DIR__ . '/runtime.php';

try {
    $config = cloudConfig();
    cloudBridgeAuth($config);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new DomainException('Adres bulunamadı.', 404);
    $db = cloudDb($config);
    $operation = $_GET['op'] ?? '';
    if ($operation === 'push') {
        $raw = cloudBody(8 * 1024 * 1024);
        $body = cloudJson($raw);
        if (($body['version'] ?? null) !== 1 || !is_array($body['payments'] ?? null) || !is_array($body['connections'] ?? null))
            throw new DomainException('Geçersiz sunucu özeti.', 400);
        cloudQuery($db, 'INSERT INTO stech_admin_snapshot(id,payload) VALUES(1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),received_at=CURRENT_TIMESTAMP(6)', [$raw]);
        cloudReply(200, ['ok' => true]);
    }
    if ($operation === 'pull') {
        $rows = $db->query('SELECT i.id,i.kind,i.basket_ref,i.provider_ref,i.device,i.amount_kurus
            FROM stech_odeal_inbox i LEFT JOIN stech_odeal_delivery d ON i.id=d.id
            WHERE d.delivered_at IS NULL AND (d.id IS NULL OR d.next_attempt_at<=CURRENT_TIMESTAMP(6))
            ORDER BY i.received_at,i.id LIMIT 25')->fetchAll();
        cloudReply(200, ['events' => $rows]);
    }
    if ($operation === 'ack') {
        $body = cloudJson(cloudBody(4096));
        $id = $body['id'] ?? '';
        $delivered = $body['delivered'] ?? null;
        if (!is_string($id) || !preg_match('/\A[a-f0-9]{64}\z/D', $id) || !is_bool($delivered))
            throw new DomainException('Geçersiz işlem kimliği.', 400);
        $db->beginTransaction();
        try {
            $exists = cloudQuery($db, 'SELECT id FROM stech_odeal_inbox WHERE id=? FOR UPDATE', [$id])->fetchColumn();
            if (!$exists) throw new DomainException('Bildirim bulunamadı.', 404);
            if ($delivered) {
                cloudQuery($db, 'INSERT INTO stech_odeal_delivery(id,delivered_at,attempts) VALUES(?,CURRENT_TIMESTAMP(6),1)
                    ON DUPLICATE KEY UPDATE delivered_at=COALESCE(delivered_at,VALUES(delivered_at))', [$id]);
            } else {
                cloudQuery($db, 'INSERT INTO stech_odeal_delivery(id,next_attempt_at,attempts) VALUES(?,CURRENT_TIMESTAMP(6)+INTERVAL 60 SECOND,1)
                    ON DUPLICATE KEY UPDATE next_attempt_at=IF(delivered_at IS NULL,VALUES(next_attempt_at),next_attempt_at),attempts=IF(delivered_at IS NULL,attempts+1,attempts)', [$id]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        cloudReply(200, ['ok' => true]);
    }
    throw new DomainException('Adres bulunamadı.', 404);
} catch (DomainException $e) {
    cloudReply($e->getCode() ?: 400, ['message' => $e->getMessage()]);
} catch (JsonException $e) {
    cloudReply(400, ['message' => 'Geçersiz JSON.']);
} catch (Throwable $e) {
    error_log('STech cloud bridge failed: ' . get_class($e));
    cloudReply(503, ['message' => 'Bağlantı işlemi tamamlanamadı.']);
}
