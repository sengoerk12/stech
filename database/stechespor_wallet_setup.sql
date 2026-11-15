USE `stechespor_wallet`;

CREATE TABLE IF NOT EXISTS stech_wallet_state (
  id TINYINT NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL,
  imported TINYINT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stech_wallet_documents (
  collection_path VARCHAR(512) NOT NULL,
  document_id VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  next_attempt_at BIGINT,
  PRIMARY KEY (collection_path, document_id),
  INDEX stech_wallet_due (collection_path, next_attempt_at, document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO stech_wallet_state (id, revision, imported) VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS stech_wallet_nonces (
  nonce CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  expires_at BIGINT UNSIGNED NOT NULL,
  INDEX stech_wallet_nonce_expiry (expires_at)
) ENGINE=InnoDB;
