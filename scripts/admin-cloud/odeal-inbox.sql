CREATE TABLE IF NOT EXISTS stech_odeal_inbox (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    basket_ref CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    provider_ref VARCHAR(100) COLLATE utf8mb4_bin NULL,
    device VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    amount_kurus INT UNSIGNED NOT NULL,
    received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX by_basket (basket_ref, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
