<?php
// Install outside public_html as stech-wallet-config.php.
return [
    'allowed_ip' => '192.0.2.10',
    'db_user' => 'replace-with-cpanel-db-user',
    'db_password' => 'replace-on-the-server',
    'public_key' => <<<'PEM'
-----BEGIN PUBLIC KEY-----
replace-with-the-Windows-public-key
-----END PUBLIC KEY-----
PEM
];
