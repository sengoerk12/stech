-- Generated from apps/api/src/database/schema.ts
BEGIN;
CREATE TABLE IF NOT EXISTS app_users (id text PRIMARY KEY, cafe_member_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_families (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), family_id uuid NOT NULL,
    kind text NOT NULL CHECK(kind IN ('access','refresh')), expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS auth_family ON auth_sessions(family_id);
CREATE TABLE IF NOT EXISTS payment_orders (
    id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), idempotency_key text NOT NULL,
    amount integer NOT NULL CHECK(amount BETWEEN 10000 AND 1000000), bonus integer NOT NULL CHECK(bonus >= 0),
    currency text NOT NULL DEFAULT 'TRY' CHECK(currency = 'TRY'), promotion_id text,
    status text NOT NULL CHECK(status IN ('pending','transferring','completed','failed')),
    provider_reference text UNIQUE, balance_after bigint, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, idempotency_key));
CREATE TABLE IF NOT EXISTS payment_events (provider text NOT NULL, event_id text NOT NULL, fingerprint text NOT NULL,
    payment_id uuid NOT NULL REFERENCES payment_orders(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider, event_id));
CREATE TABLE IF NOT EXISTS transfer_jobs (
    payment_id uuid PRIMARY KEY REFERENCES payment_orders(id), status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','retry','completed','reconciliation')),
    attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS transfer_ledger (
    payment_id uuid NOT NULL REFERENCES payment_orders(id), kind text NOT NULL CHECK(kind IN ('topup','bonus')),
    amount integer NOT NULL CHECK(amount > 0), remote_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(payment_id, kind));
CREATE TABLE IF NOT EXISTS notification_preferences (user_id text PRIMARY KEY REFERENCES app_users(id), marketing boolean NOT NULL DEFAULT false, transactions boolean NOT NULL DEFAULT true, low_balance boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS audit_logs (id uuid PRIMARY KEY, event text NOT NULL, resource_id text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_promotions (id text PRIMARY KEY, definition jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS demo_wallets (user_id text PRIMARY KEY REFERENCES app_users(id), balance bigint NOT NULL CHECK(balance >= 0 AND balance <= 9007199254740991), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS demo_wallet_operations (operation_id text PRIMARY KEY, user_id text NOT NULL REFERENCES demo_wallets(user_id), amount integer NOT NULL, bonus integer NOT NULL, balance_after bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS demo_wallet_transactions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES demo_wallets(user_id), kind text NOT NULL, amount integer NOT NULL, title text NOT NULL, balance_after bigint NOT NULL, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS payment_user_created ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_transactions_created ON demo_wallet_transactions(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
