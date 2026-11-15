<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function fail(int $status, string $code = ''): void {
    http_response_code($status);
    if ($code !== '') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['code' => $code], JSON_THROW_ON_ERROR);
    }
    exit;
}

// Never use forwarding headers supplied by the caller.
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (strncmp($ip, '::ffff:', 7) === 0) $ip = substr($ip, 7);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' ||
    !in_array(strtolower($_SERVER['HTTPS'] ?? ''), ['on', '1'], true)) fail(404);

$configPath = dirname(__DIR__, 2) . '/stech-wallet-config.php';
if (!is_readable($configPath)) fail(404);
$config = require $configPath;
if (!is_array($config) || $ip !== ($config['allowed_ip'] ?? null)) fail(404);

$timestamp = $_SERVER['HTTP_X_STECH_WALLET_TIME'] ?? '';
$nonce = $_SERVER['HTTP_X_STECH_WALLET_NONCE'] ?? '';
$signature = base64_decode($_SERVER['HTTP_X_STECH_WALLET_SIGNATURE'] ?? '', true);
if (!preg_match('/\A\d{10}\z/D', $timestamp) || abs(time() - (int)$timestamp) > 60 ||
    !preg_match('/\A[a-f0-9]{32}\z/D', $nonce) || $signature === false ||
    strlen($signature) < 64 || strlen($signature) > 80) fail(404);

const MAX_BODY = 4194304;
$body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($body === false || strlen($body) > MAX_BODY) fail(404);
$message = "stech-wallet-v1\n" . $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
$publicKey = openssl_pkey_get_public($config['public_key'] ?? '');
if (!$publicKey || openssl_verify($message, $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) fail(404);

function collectionPath($path): string {
    if (!is_string($path) || strlen($path) > 512 ||
        !preg_match('/\ApancafeInstallations(?:\/[A-Za-z0-9_.-]{1,191}\/[A-Za-z0-9_.-]{1,191})*\z/D', $path))
        throw new DomainException('INVALID_REQUEST');
    return $path;
}

function documentId($id): string {
    if (!is_string($id) || !preg_match('/\A[A-Za-z0-9_.-]{1,191}\z/D', $id))
        throw new DomainException('INVALID_REQUEST');
    return $id;
}

function query(PDO $db, string $sql, array $args = []): PDOStatement {
    $stmt = $db->prepare($sql);
    foreach ($args as $index => $value) {
        $type = $value === null ? PDO::PARAM_NULL : (is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        $stmt->bindValue($index + 1, $value, $type);
    }
    $stmt->execute();
    return $stmt;
}

function getDocument(PDO $db, string $path, string $id): ?array {
    $row = query($db, 'SELECT document_id, payload, revision FROM stech_wallet_documents WHERE collection_path=? AND document_id=?',
        [$path, $id])->fetch();
    return $row === false ? null : unpackDocument($row);
}

function unpackDocument(array $row): array {
    return ['id' => $row['document_id'], 'revision' => (string)$row['revision'],
        'data' => json_decode($row['payload'], false, 64, JSON_THROW_ON_ERROR)];
}

function persist(PDO $db, string $path, string $id, object $data): void {
    $due = isset($data->nextAttemptAt) && is_int($data->nextAttemptAt) ? $data->nextAttemptAt : null;
    query($db, 'UPDATE stech_wallet_state SET revision=revision+1 WHERE id=1');
    query($db, 'INSERT INTO stech_wallet_documents(collection_path,document_id,payload,revision,next_attempt_at)
        SELECT ?,?,?,revision,? FROM stech_wallet_state WHERE id=1
        ON DUPLICATE KEY UPDATE payload=VALUES(payload),revision=VALUES(revision),next_attempt_at=VALUES(next_attempt_at)',
        [$path, $id, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), $due]);
}

function lockStore(PDO $db): bool {
    $value = query($db, 'SELECT imported FROM stech_wallet_state WHERE id=1 FOR UPDATE')->fetchColumn();
    if ($value === false) throw new RuntimeException('Missing wallet store');
    return (int)$value === 1;
}

function operate(PDO $db, object $request): array {
    $action = $request->action ?? null;
    if ($action === 'status') {
        $imported = query($db, 'SELECT imported FROM stech_wallet_state WHERE id=1')->fetchColumn();
        if ($imported === false) throw new RuntimeException('Missing wallet store');
        query($db, 'SELECT document_id FROM stech_wallet_documents LIMIT 0');
        return ['imported' => (int)$imported === 1];
    }
    if ($action === 'get') {
        return ['document' => getDocument($db, collectionPath($request->collection ?? null), documentId($request->id ?? null))];
    }
    if ($action === 'list') {
        $path = collectionPath($request->collection ?? null);
        if (isset($request->due)) {
            $limit = $request->limit ?? 25;
            if (!is_int($request->due) || !is_int($limit) || $limit < 1 || $limit > 100) throw new DomainException('INVALID_REQUEST');
            $stmt = query($db, 'SELECT document_id,payload,revision FROM stech_wallet_documents
                WHERE collection_path=? AND next_attempt_at<=? ORDER BY next_attempt_at,document_id LIMIT ?', [$path, $request->due, $limit]);
        } else {
            $stmt = query($db, 'SELECT document_id,payload,revision FROM stech_wallet_documents
                WHERE collection_path=? ORDER BY document_id', [$path]);
        }
        return ['documents' => array_map('unpackDocument', $stmt->fetchAll())];
    }
    if ($action === 'import') {
        if (lockStore($db)) throw new DomainException('ALREADY_EXISTS');
        $docs = $request->documents ?? null;
        if (!is_array($docs) || count($docs) > 10000) throw new DomainException('INVALID_REQUEST');
        if (query($db, 'SELECT 1 FROM stech_wallet_documents LIMIT 1')->fetchColumn())
            throw new DomainException('FAILED_PRECONDITION');
        foreach ($docs as $doc) {
            if (!is_object($doc) || !is_object($doc->data ?? null)) throw new DomainException('INVALID_REQUEST');
            persist($db, collectionPath($doc->collection ?? null), documentId($doc->id ?? null), $doc->data);
        }
        if ((int)query($db, 'SELECT COUNT(*) FROM stech_wallet_documents')->fetchColumn() !== count($docs))
            throw new DomainException('FAILED_PRECONDITION');
        query($db, 'UPDATE stech_wallet_state SET imported=1 WHERE id=1');
        return ['ok' => true];
    }
    if ($action !== 'commit' || !is_array($request->reads ?? null) || !is_array($request->writes ?? null) ||
        count($request->reads) > 250 || count($request->writes) > 250) throw new DomainException('INVALID_REQUEST');
    if (!lockStore($db)) throw new DomainException('NOT_IMPORTED');
    foreach ($request->reads as $read) {
        if (!is_object($read) || !property_exists($read, 'revision')) throw new DomainException('INVALID_REQUEST');
        $current = getDocument($db, collectionPath($read->collection ?? null), documentId($read->id ?? null));
        if (($current['revision'] ?? null) !== $read->revision) throw new DomainException('RETRY_TRANSACTION');
    }
    foreach ($request->writes as $write) {
        if (!is_object($write)) throw new DomainException('INVALID_REQUEST');
        $path = collectionPath($write->collection ?? null);
        $id = documentId($write->id ?? null);
        $kind = $write->kind ?? null;
        if ($kind === 'delete') {
            query($db, 'DELETE FROM stech_wallet_documents WHERE collection_path=? AND document_id=?', [$path, $id]);
            continue;
        }
        if (!is_object($write->data ?? null) || !in_array($kind, ['create', 'replace', 'merge', 'update'], true))
            throw new DomainException('INVALID_REQUEST');
        $current = getDocument($db, $path, $id);
        if ($kind === 'create' && $current !== null) throw new DomainException('ALREADY_EXISTS');
        if ($kind === 'update' && $current === null) throw new DomainException('NOT_FOUND');
        if ($kind === 'update' && isset($write->revision) && $current['revision'] !== $write->revision)
            throw new DomainException('FAILED_PRECONDITION');
        $data = $kind === 'merge' || $kind === 'update'
            ? (object)array_replace((array)($current['data'] ?? []), (array)$write->data)
            : $write->data;
        persist($db, $path, $id, $data);
    }
    return ['ok' => true];
}

$db = null;
try {
    $request = json_decode($body, false, 64, JSON_THROW_ON_ERROR);
    if (!is_object($request)) fail(400, 'INVALID_REQUEST');
    $db = new PDO('mysql:host=localhost;dbname=stechespor_wallet;charset=utf8mb4', $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 5,
    ]);
    // Record the signed nonce even if the subsequent transaction rolls back.
    try {
        query($db, 'INSERT INTO stech_wallet_nonces(nonce, expires_at) VALUES (?,?)', [$nonce, time() + 121]);
    } catch (PDOException $error) {
        if ((int)($error->errorInfo[1] ?? 0) === 1062) fail(404);
        throw $error;
    }
    query($db, 'DELETE FROM stech_wallet_nonces WHERE expires_at<? LIMIT 250', [time()]);
    $db->beginTransaction();
    $result = operate($db, $request);
    $db->commit();
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (DomainException $error) {
    if ($db && $db->inTransaction()) $db->rollBack();
    $code = $error->getMessage();
    fail($code === 'INVALID_REQUEST' ? 400 : 409, $code);
} catch (Throwable $error) {
    if ($db && $db->inTransaction()) $db->rollBack();
    fail(503, 'WALLET_UNAVAILABLE');
}
