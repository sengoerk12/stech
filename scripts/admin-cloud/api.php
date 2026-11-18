<?php
declare(strict_types=1);
require __DIR__ . '/runtime.php';

function owner(array $config): array
{
    return ['id' => 'hosted-owner', 'username' => $config['owner'], 'role' => 'viewer'];
}

function restrictLogin(PDO $db, string $key): void
{
    $window = intdiv(time(), 60);
    // Check both the client and the account-wide window.
    $global = hash_hmac('sha256', 'login-global', $key);
    $local = hash_hmac('sha256', 'login:' . ($_SERVER['REMOTE_ADDR'] ?? ''), $key);
    foreach ([$global => 30, $local => 8] as $id => $limit) {
        cloudQuery($db, 'INSERT INTO stech_admin_cloud_attempts VALUES(?,?,1) ON DUPLICATE KEY UPDATE
            attempts=IF(attempt_window=VALUES(attempt_window),attempts+1,1),attempt_window=VALUES(attempt_window)', [$id, $window]);
        $attempts = cloudQuery($db, 'SELECT attempts FROM stech_admin_cloud_attempts WHERE address_hash=?', [$id])->fetchColumn();
        if ((int)$attempts > $limit) throw new DomainException('Çok fazla giriş denemesi. Bir dakika sonra tekrar dene.', 429);
    }
    cloudQuery($db, 'DELETE FROM stech_admin_cloud_attempts WHERE attempt_window<? LIMIT 200', [$window - 120]);
}

function snapshot(PDO $db): array
{
    $stored = $db->query('SELECT payload,received_at FROM stech_admin_snapshot WHERE id=1')->fetch();
    if (!$stored) return ['summary' => ['waiting' => 0], 'topupEnabled' => false, 'payments' => [], 'connections' => []];
    $data = cloudJson($stored['payload']);
    $online = strtotime($stored['received_at'] . ' UTC') >= time() - 90;
    $data['connected'] = $online && !empty($data['connected']);
    $data['topupEnabled'] = $online && !empty($data['topupEnabled']);
    $data['balanceAdjustment'] = false;
    $data['lastSnapshotAt'] = gmdate('c', strtotime($stored['received_at'] . ' UTC'));
    // Match receipts to already-synchronized basket, amount and terminal before reporting a charge.
    $events = $db->query("SELECT basket_ref,device,amount_kurus,kind,MIN(received_at) AS first_seen FROM stech_odeal_inbox
        GROUP BY basket_ref,device,amount_kurus,kind")->fetchAll();
    $byBasket = [];
    foreach ($events as $event) $byBasket[$event['basket_ref']][$event['device']][$event['amount_kurus']][$event['kind']] = $event;
    foreach ($data['payments'] as &$payment) {
        $matching = $byBasket[$payment['id']][$payment['pos_device_code']][$payment['amount']] ?? [];
        $event = $matching['payment-succeeded'] ?? null;
        if (!$event || $payment['status'] === 'failed' || ($payment['status'] === 'pending' && $payment['pos_cancelled_at'])) continue;
        $received = strtotime($event['first_seen'] . ' UTC');
        if (!$payment['captured_at'] || $received < strtotime($payment['captured_at'])) $payment['captured_at'] = gmdate('c', $received);
        if ($payment['status'] !== 'pending') continue;
        $payment['status'] = 'transferring';
        $payment['transfer_status'] = isset($matching['payment-cancelled']) ? 'reconciliation' : 'queued';
    }
    unset($payment);
    $data['summary']['waiting'] = count(array_filter($data['payments'], static function ($p) { return $p['status'] === 'transferring'; }));
    return $data;
}

function reportDay($value): DateTimeImmutable
{
    $day = is_string($value) ? DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('Europe/Istanbul')) : false;
    if (!$day || $day->format('Y-m-d') !== $value) throw new DomainException('Geçerli bir tarih seç.', 400);
    return $day;
}

function paymentReport(array $payments, $from, $to): array
{
    $begin = reportDay($from);
    $end = reportDay($to)->modify('+1 day');
    if ($end <= $begin || $begin->diff($end)->days > 366) throw new DomainException('1–366 günlük bir tarih aralığı seç.', 400);
    $within = static function ($at) use ($begin, $end): bool {
        $time = $at ? new DateTimeImmutable($at) : null;
        return $time && $time >= $begin && $time < $end;
    };
    $summary = ['captured'=>0, 'captured_count'=>0, 'waiting'=>0, 'waiting_count'=>0, 'transferred'=>0, 'bonus'=>0];
    foreach ($payments as $p) {
        if ($within($p['captured_at'])) {
            $summary['captured'] += $p['amount'];
            $summary['captured_count']++;
            if ($p['status'] === 'transferring') {
                $summary['waiting'] += $p['amount'];
                $summary['waiting_count']++;
            }
        }
        if ($within($p['credited_at'])) $summary['transferred'] += $p['amount'];
        if ($within($p['bonus_at'])) $summary['bonus'] += $p['bonus'];
    }
    return ['from' => $from, 'to' => $to, 'live' => true, 'summary' => $summary];
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $route = $_GET['route'] ?? '';
    if ($method === 'POST' && ($_SERVER['HTTP_ORIGIN'] ?? '') !== 'https://stechespor.com')
        throw new DomainException('Bu işlem S TECH panelinden yapılmalı.', 403);
    $config = cloudConfig();
    if ($method === 'GET' && $route === 'auth/status') cloudReply(200, ['setupRequired' => false]);
    $db = cloudDb($config);
    if ($method === 'POST' && $route === 'auth/login') {
        restrictLogin($db, $config['bridge_key']);
        $body = cloudJson(cloudBody(4096));
        $pass = $body['password'] ?? null;
        $name = $body['username'] ?? null;
        if (!is_string($pass) || $pass === '' || strlen($pass) > 512 || !is_string($name) ||
            !hash_equals($config['owner_verifier'], hash_pbkdf2('sha256', $pass, $config['owner_salt'], 600000, 64)) ||
            strtolower(trim($name)) !== $config['owner']) throw new DomainException('Yönetici adı veya şifre hatalı.', 401);
        $token = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        cloudQuery($db, 'DELETE FROM stech_admin_cloud_sessions WHERE expires_at<? LIMIT 250', [time()]);
        cloudQuery($db, 'INSERT INTO stech_admin_cloud_sessions VALUES(?,?)', [hash_hmac('sha256', $token, $config['owner_verifier']), time()+28800]);
        cloudReply(200, ['token' => $token, 'admin' => owner($config)]);
    }
    $token = $_SERVER['HTTP_X_STECH_ADMIN_SESSION'] ?? '';
    if (!preg_match('/\A[A-Za-z0-9_-]{64}\z/D', $token)) throw new DomainException('Yönetici girişi gerekli.', 401);
    $hash = hash_hmac('sha256', $token, $config['owner_verifier']);
    if (!cloudQuery($db, 'SELECT 1 FROM stech_admin_cloud_sessions WHERE token_hash=? AND expires_at>?', [$hash,time()])->fetchColumn())
        throw new DomainException('Yönetici oturumu sona erdi.', 401);
    if ($method === 'POST' && $route === 'auth/logout') {
        cloudQuery($db, 'DELETE FROM stech_admin_cloud_sessions WHERE token_hash=?', [$hash]);
        cloudReply(200, ['ok' => true]);
    }
    if ($method !== 'GET') throw new DomainException('Adres bulunamadı.', 404);
    $data = snapshot($db);
    $payments = $data['payments']; unset($data['payments']);
    if ($route === 'overview') cloudReply(200, $data);
    if ($route === 'payment-report') cloudReply(200, paymentReport($payments, $_GET['from'] ?? null, $_GET['to'] ?? null));
    if ($route === 'payments') {
        $status = $_GET['status'] ?? '';
        $search = $_GET['search'] ?? '';
        $before = $_GET['before'] ?? '';
        $beforeId = $_GET['beforeId'] ?? '';
        if (!is_string($search) || !preg_match('/\A[a-zA-Z0-9_.-]{0,36}\z/D', $search) || !is_string($before) || !is_string($beforeId) ||
            !in_array($status, ['', 'pending','transferring','completed','failed'], true)) throw new DomainException('Geçersiz ödeme filtresi.', 400);
        $rows = [];
        foreach ($payments as $p) {
            $p['cursor_date'] = $p['created_at'];
            if ($before !== '' && ($p['created_at'] > $before || ($p['created_at'] === $before && strcmp($p['id'], $beforeId) >= 0))) continue;
            if ($status !== '' && $status !== $p['status']) continue;
            if ($search !== '' && stripos($p['username'] ?? '', $search) === false && stripos($p['id'], $search) !== 0) continue;
            $rows[] = $p;
            if (count($rows) >= 100) break;
        }
        cloudReply(200, $rows);
    }
    if (is_string($route) && preg_match('~\Apayments/([0-9a-f-]{36})\z~D', $route, $match)) {
        foreach ($payments as $p) {
            if ($p['id'] !== $match[1]) continue;
            $timeline = [];
            foreach (['captured_at'=>'transferring','credited_at'=>'completed'] as $date => $status)
                if ($p[$date]) $timeline[] = ['event' => 'payment.status', 'status' => $status, 'created_at' => $p[$date]];
            cloudReply(200, ['payment' => $p, 'timeline' => $timeline]);
        }
    }
    throw new DomainException('Adres bulunamadı.', 404);
} catch (DomainException $e) {
    cloudReply($e->getCode() ?: 400, ['message' => $e->getMessage()]);
} catch (JsonException $e) {
    cloudReply(400, ['message' => 'Geçersiz JSON.']);
} catch (Throwable $e) {
    error_log('STech cloud admin failed: ' . get_class($e));
    cloudReply(503, ['message' => 'Yönetim verilerine erişilemedi.']);
}
