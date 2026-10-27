BEGIN;
CREATE TABLE IF NOT EXISTS cafe_member_links (
  user_id text PRIMARY KEY REFERENCES app_users(id),
  installation_id text NOT NULL,
  member_id bigint NOT NULL,
  member_username text NOT NULL,
  UNIQUE(installation_id,member_username)
);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
COMMIT;
