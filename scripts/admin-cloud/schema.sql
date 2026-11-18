CREATE TABLE IF NOT EXISTS stech_admin_snapshot (
    id TINYINT UNSIGNED PRIMARY KEY,
    payload LONGTEXT NOT NULL,
    received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stech_admin_cloud_sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    expires_at BIGINT UNSIGNED NOT NULL,
    KEY expires_sessions (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stech_admin_cloud_attempts (
    address_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    attempt_window BIGINT UNSIGNED NOT NULL,
    attempts INT UNSIGNED NOT NULL,
    KEY attempt_windows (attempt_window)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stech_odeal_delivery (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    delivered_at TIMESTAMP(6) NULL,
    next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (id) REFERENCES stech_odeal_inbox(id),
    KEY ready_to_send (delivered_at, next_attempt_at)
) ENGINE=InnoDB;
