<?php
declare(strict_types=1);

final class OdealNotification
{
    private const UUID = '/\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/i';
    private const TYPES = ['payment-succeeded', 'payment-cancelled', 'basket-cancelled', 'payment-failed'];
    private const CARD_METHODS = ['Kredi Kartı / Banka Kartı', 'Kredi Kartı', 'Banka Kartı', 'CREDITCARD', 'TERMINAL'];

    public static function verify(string $type, string $raw, string $incomingKey, string $expectedKey, string $device): ?array
    {
        if (!in_array($type, self::TYPES, true)) throw new DomainException('unknown_notification', 404);
        if (strlen($expectedKey) < 32 || !hash_equals(hash('sha256', $expectedKey), hash('sha256', $incomingKey)))
            throw new DomainException('invalid_request_key', 401);
        if (strlen($raw) > 1048576) throw new DomainException('notification_too_large', 413);
        try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
        catch (JsonException $error) { throw new DomainException('invalid_notification', 400, $error); }
        if (!is_array($body)) throw new DomainException('invalid_notification', 400);

        $payment = $body['PaymentDetail'] ?? null;
        $basket = $type === 'basket-cancelled' ? ($body['Basket'] ?? $body) : ($body['BasketDetail'] ?? null);
        // Ödeal can report a failed attempt before a basket exists.
        if ($type === 'payment-failed' && $basket === null) return null;
        if (!is_array($basket) || ($type !== 'basket-cancelled' && !is_array($payment)))
            throw new DomainException('invalid_notification', 400);
        $basketRef = $basket['BasketRefCode'] ?? '';
        if (!is_string($basketRef) || !preg_match(self::UUID, $basketRef) ||
            (isset($basket['ExternalDeviceKey']) && $basket['ExternalDeviceKey'] !== $device))
            throw new DomainException('invalid_basket_or_device', 400);
        $amount = $type === 'basket-cancelled' ? ($basket['GrossPrice'] ?? null) : ($payment['Amount'] ?? null);
        if ((!is_int($amount) && !is_float($amount)) || !is_finite((float)$amount) || $amount <= 0 ||
            $amount > 10000 || abs($amount * 100 - round($amount * 100)) > 0.000001)
            throw new DomainException('invalid_amount', 400);

        $providerRef = null;
        if ($type === 'payment-succeeded') {
            $providerRef = $body['PaymentRefCode'] ?? '';
            if (!is_string($providerRef) || trim($providerRef) === '' || strlen($providerRef) > 100 ||
                empty($payment['AuthCode']) || !empty($payment['FailReason']) || !empty($payment['CancelledDate']) ||
                !in_array($payment['PaymentMethod'] ?? null, self::CARD_METHODS, true))
                throw new DomainException('unconfirmed_payment', 400);
        }
        if ($type === 'payment-failed' && !empty($payment['AuthCode']))
            throw new DomainException('invalid_failed_payment', 400);

        $basketRef = strtolower($basketRef);
        return [
            'id' => hash('sha256', $type . "\n" . ($providerRef ?? $basketRef)),
            'kind' => $type,
            'basket_ref' => $basketRef,
            'provider_ref' => $providerRef,
            'device' => $device,
            'amount_kurus' => (int)round($amount * 100),
        ];
    }

    public static function persist(PDO $db, array $event): void
    {
        $db->beginTransaction();
        try {
            $put = $db->prepare('INSERT INTO stech_odeal_inbox (id,kind,basket_ref,provider_ref,device,amount_kurus) VALUES (?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE id=id');
            $put->execute([$event['id'], $event['kind'], $event['basket_ref'], $event['provider_ref'], $event['device'], $event['amount_kurus']]);
            $lookup = $db->prepare('SELECT kind,basket_ref,provider_ref,device,amount_kurus FROM stech_odeal_inbox WHERE id=? FOR UPDATE');
            $lookup->execute([$event['id']]);
            $saved = $lookup->fetch(PDO::FETCH_ASSOC);
            if (!$saved || $saved['kind'] !== $event['kind'] || $saved['basket_ref'] !== $event['basket_ref'] ||
                $saved['provider_ref'] !== $event['provider_ref'] || $saved['device'] !== $event['device'] ||
                (int)$saved['amount_kurus'] !== $event['amount_kurus'])
                throw new DomainException('notification_conflict', 409);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
}
