BEGIN;
CREATE TABLE IF NOT EXISTS demo_members (
  user_id text PRIMARY KEY REFERENCES app_users(id), username text NOT NULL UNIQUE,
  name text NOT NULL, phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  password_hash text NOT NULL, salt text NOT NULL, joined_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
