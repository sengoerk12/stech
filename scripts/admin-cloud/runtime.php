<?php
declare(strict_types=1);

function cloudReply(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function cloudConfig(): array
{
    $path = dirname(__DIR__, 3) . '/stech-admin-cloud.php';
    if (!is_readable($path)) cloudReply(503, ['message' => 'Yönetim sunucusunun özel ayarı eksik.']);
    $config = require $path;
    if (!is_array($config) || !isset($config['db_user'], $config['db_password'], $config['bridge_key'], $config['owner'], $config['owner_salt'], $config['owner_verifier']))
        cloudReply(503, ['message' => 'Yönetim sunucusunun özel ayarı eksik.']);
    return $config;
}

function cloudDb(array $config): PDO
{
    return new PDO('mysql:host=localhost;dbname=stechespor_admin;charset=utf8mb4', $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00'",
        PDO::ATTR_TIMEOUT => 5,
    ]);
}

function cloudQuery(PDO $db, string $sql, array $params = []): PDOStatement
{
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function cloudBody(int $limit): string
{
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) throw new DomainException('İstek boyutu sınırı aşıldı.', 413);
    return $raw;
}

function cloudJson(string $raw): array
{
    $body = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($body)) throw new DomainException('Geçersiz istek.', 400);
    return $body;
}

function cloudBridgeAuth(array $config): void
{
    $key = $_SERVER['HTTP_X_STECH_CLOUD_BRIDGE'] ?? '';
    if (!preg_match('/\A[a-f0-9]{64}\z/D', $config['bridge_key']) || !hash_equals($config['bridge_key'], $key))
        throw new DomainException('Adres bulunamadı.', 404);
}
