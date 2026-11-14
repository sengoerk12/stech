/** Runtime migration v1. The demo cafe tables emulate the external owner only. */
export const schema = [
  `CREATE TABLE IF NOT EXISTS app_users (id text PRIMARY KEY, cafe_member_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS auth_families (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), revoked boolean NOT NULL DEFAULT false)`,
  `ALTER TABLE auth_families ADD COLUMN IF NOT EXISTS is_kiosk boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), family_id uuid NOT NULL,
    kind text NOT NULL CHECK(kind IN ('access','refresh')), expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false)`,
  `CREATE INDEX IF NOT EXISTS auth_family ON auth_sessions(family_id)`,
  `CREATE TABLE IF NOT EXISTS payment_orders (
    id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), idempotency_key text NOT NULL,
    amount integer NOT NULL CHECK(amount BETWEEN 10000 AND 1000000), bonus integer NOT NULL CHECK(bonus >= 0),
    currency text NOT NULL DEFAULT 'TRY' CHECK(currency = 'TRY'), promotion_id text,
    status text NOT NULL CHECK(status IN ('pending','transferring','completed','failed')),
    provider_reference text UNIQUE, balance_after bigint, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key))`,
  `CREATE TABLE IF NOT EXISTS payment_events (provider text NOT NULL, event_id text NOT NULL, fingerprint text NOT NULL,
    payment_id uuid NOT NULL REFERENCES payment_orders(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider, event_id))`,
  `CREATE TABLE IF NOT EXISTS transfer_jobs (
    payment_id uuid PRIMARY KEY REFERENCES payment_orders(id), status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','retry','completed','reconciliation')),
    attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS transfer_ledger (
    payment_id uuid NOT NULL REFERENCES payment_orders(id), kind text NOT NULL CHECK(kind IN ('topup','bonus')),
    amount integer NOT NULL CHECK(amount > 0), remote_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(payment_id, kind))`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (user_id text PRIMARY KEY REFERENCES app_users(id), marketing boolean NOT NULL DEFAULT false, transactions boolean NOT NULL DEFAULT true, low_balance boolean NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id uuid PRIMARY KEY, event text NOT NULL, resource_id text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS app_promotions (id text PRIMARY KEY, definition jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS demo_wallets (user_id text PRIMARY KEY REFERENCES app_users(id), balance bigint NOT NULL CHECK(balance >= 0 AND balance <= 9007199254740991), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS demo_wallet_operations (operation_id text PRIMARY KEY, user_id text NOT NULL REFERENCES demo_wallets(user_id), amount integer NOT NULL, bonus integer NOT NULL, balance_after bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS demo_wallet_transactions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES demo_wallets(user_id), kind text NOT NULL, amount integer NOT NULL, title text NOT NULL, balance_after bigint NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payment_user_created ON payment_orders(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS demo_transactions_created ON demo_wallet_transactions(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  `INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS demo_members (
    user_id text PRIMARY KEY REFERENCES app_users(id), username text NOT NULL UNIQUE,
    name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
    password_hash text NOT NULL, salt text NOT NULL, joined_at timestamptz NOT NULL DEFAULT now())`,
  `INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=3) THEN
      ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_amount_check;
      ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amount_check CHECK(amount BETWEEN 5000 AND 1000000);
      UPDATE app_promotions SET definition=definition || '{"minimumAmount":20000,"bonusPercent":10,"maxBonus":100000,"description":"200 TL ve üzeri yüklemelerde %10 bonus hesabında.","terms":"Tek yüklemede en az 200 TL. Yükleme tutarına %10 bonus eklenir. Diğer kampanyalarla birleştirilemez. Demo kampanyasıdır."}'::jsonb WHERE id='welcome-bonus';
      INSERT INTO schema_migrations(version) VALUES(3);
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS cafe_member_links (user_id text PRIMARY KEY REFERENCES app_users(id), installation_id text NOT NULL, member_id bigint NOT NULL, member_username text NOT NULL, UNIQUE(installation_id,member_username))`,
  `INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING`,
  `ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS transfer_target text NOT NULL DEFAULT 'mock' CHECK(transfer_target IN ('mock','pancafe'))`,
  `ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'mock' CHECK(payment_provider IN ('mock','odeal'))`,
  `ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS pos_device_code text`,
  `ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS checkout_started boolean NOT NULL DEFAULT false`,
  `ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS pos_cancelled_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS odeal_active_device ON payment_orders(pos_device_code)
    WHERE payment_provider='odeal' AND status IN ('pending','transferring')`,
  `INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS admin_accounts (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, salt text NOT NULL, role text NOT NULL CHECK(role IN ('owner','operator','viewer')), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admin_accounts(id), expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_adjustments (id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admin_accounts(id), member_id integer NOT NULL, username text NOT NULL, delta bigint NOT NULL, bonus_delta bigint NOT NULL, expected_balance bigint NOT NULL, expected_bonus bigint NOT NULL, reason text NOT NULL, status text NOT NULL CHECK(status IN ('pending','completed','rejected')), balance_after bigint, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS admin_content (kind text NOT NULL, id uuid NOT NULL, definition jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,id))`,
  `ALTER TABLE app_promotions ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true`,
  `ALTER TABLE app_promotions ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1`,
  `INSERT INTO schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS member_profile_changes (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), request_hash text NOT NULL, encrypted_before text NOT NULL, encrypted_after text NOT NULL, changed_fields jsonb NOT NULL, status text NOT NULL CHECK(status IN ('pending','completed','rejected')), password_changed boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz)`,
  `CREATE INDEX IF NOT EXISTS member_profile_changes_user ON member_profile_changes(user_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS demo_profile_details (user_id text PRIMARY KEY REFERENCES app_users(id), address text NOT NULL DEFAULT '')`,
  `ALTER TABLE demo_profile_details ADD COLUMN IF NOT EXISTS first_name text`,
  `ALTER TABLE demo_profile_details ADD COLUMN IF NOT EXISTS last_name text`,
  `CREATE TABLE IF NOT EXISTS demo_profile_receipts (id uuid PRIMARY KEY, user_id text NOT NULL, request_hash text NOT NULL)`,
  `INSERT INTO schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS promotion_sync_outbox (id text PRIMARY KEY REFERENCES app_promotions(id), operation_id uuid NOT NULL, payload jsonb NOT NULL)`,
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=8) THEN
    INSERT INTO promotion_sync_outbox(id,operation_id,payload)
      SELECT p.id,gen_random_uuid(),p.definition || jsonb_build_object('active',p.active)
      FROM app_promotions p WHERE EXISTS(SELECT 1 FROM audit_logs a WHERE a.event='admin.promotion.save' AND a.resource_id=p.id)
      ON CONFLICT DO NOTHING;
    INSERT INTO schema_migrations(version) VALUES(8);
  END IF; END $$`,
  `CREATE TABLE IF NOT EXISTS s_coin_awards (
    payment_id uuid PRIMARY KEY REFERENCES payment_orders(id), installation_id text NOT NULL,
    member_id bigint NOT NULL, units bigint NOT NULL CHECK(units>0), test_only boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), synced_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS s_coin_pending ON s_coin_awards(installation_id,test_only,created_at) WHERE synced_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS kiosk_design_state(id integer PRIMARY KEY CHECK(id=1),revision integer NOT NULL,document jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kiosk_design_versions(sequence bigserial UNIQUE,id uuid PRIMARY KEY,document jsonb NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=9) THEN
    ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_amount_check;
    ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amount_check CHECK(amount BETWEEN 100 AND 1000000);
    INSERT INTO schema_migrations(version) VALUES(9);
  END IF; END $$`,
];
