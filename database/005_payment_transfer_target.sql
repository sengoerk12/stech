ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS transfer_target text NOT NULL DEFAULT 'mock'
  CHECK(transfer_target IN ('mock','pancafe'));
INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
