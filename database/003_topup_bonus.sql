BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=3) THEN
    ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_amount_check;
    ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amount_check CHECK(amount BETWEEN 5000 AND 1000000);
    UPDATE app_promotions SET definition=definition || '{"minimumAmount":20000,"bonusPercent":10,"maxBonus":100000,"description":"200 TL ve üzeri yüklemelerde %10 bonus hesabında.","terms":"Tek yüklemede en az 200 TL. Yükleme tutarına %10 bonus eklenir. Diğer kampanyalarla birleştirilemez. Demo kampanyasıdır."}'::jsonb WHERE id='welcome-bonus';
    INSERT INTO schema_migrations(version) VALUES(3);
  END IF;
END $$;
COMMIT;
