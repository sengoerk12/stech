# PanCafe Wallet kurulumu

S TECH API Windows’taki PanCafe bilgisayarında çalışır. cPanel’deki `stechespor_wallet`, kampanyaları, PanCafe üye ve bakiye eşitlemesini, S Coin bakiyelerini ve çark ödüllerini saklar. PanCafe, oyun bakiyesinin kaynağı olmaya devam eder. Ödeal işlemleri ve S TECH API’nin mevcut yerel PostgreSQL/PGlite verileri mevcut depolarında kalır. Kiosk ve mobil uygulama mevcut S TECH API adresini kullanır.

## cPanel’de PHP kurulumu

1. phpMyAdmin’de `stechespor_wallet` veritabanını seç. **İçe aktar** sekmesinden `database/stechespor_wallet_setup.sql` dosyasını çalıştır.
2. cPanel **MySQL Veritabanları** bölümünde `wallet_api` kullanıcısını oluştur. cPanel’in gösterdiği tam kullanıcı adını kullan ve kullanıcıyı yalnızca `stechespor_wallet` veritabanına `SELECT`, `INSERT`, `UPDATE`, `DELETE` izinleriyle ekle.
3. Windows’ta S TECH API’yi başlattığın hesapla, proje klasöründe `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\wallet-hosting\New-WalletKey.ps1` çalıştır. `%LOCALAPPDATA%\STech-Kiosk-Sunucu\wallet-public.pem` dosyasının içeriğini kopyala. `wallet-private.dpapi` dosyasını Windows’ta sakla.
4. cPanel **Dosya Yöneticisi**nde `/home/stechespor/public_html/wallet` klasörünü oluştur. `scripts/wallet-hosting/index.php` dosyasını bu klasöre yükle. Alan adında HTTPS, PHP 8 ve `pdo_mysql` ile `openssl` uzantıları gerekir.
5. `scripts/wallet-hosting/stech-wallet-config.example.php` dosyasını `/home/stechespor` dizinine yükle ve `stech-wallet-config.php` adını ver. `db_user` ve `db_password` alanlarına 2. adımdaki bilgileri yaz. PHP’nin tek tırnaklı parola alanında `\` karakteri `\\`, `'` karakteri `\'` olarak yazılır. `public_key` bloğundaki örnek PEM satırlarının tamamını Windows’tan aldığın PEM ile değiştir. `allowed_ip` alanı Windows’un internet çıkış IP’sidir. SQL erişimi cPanel’de `localhost` üzerinden kurulur.

## Windows bağlantı kontrolü

`%LOCALAPPDATA%\STech-Kiosk-Sunucu\wallet-api.env.pending` dosyasını oluştur. Aşağıdaki özel anahtar yolunu API’yi çalıştırdığın Windows hesabının gerçek yoluna göre yaz.

```dotenv
WALLET_HTTPS_URL=https://stechespor.com/wallet/index.php
WALLET_HTTPS_PRIVATE_KEY_FILE="C:/Users/Stech - Kasa/AppData/Local/STech-Kiosk-Sunucu/wallet-private.dpapi"
WALLET_BALANCE_WRITE_ENABLED=true
```

Proje klasöründe `npm run build:api` komutunu çalıştırıp imzalı bağlantıyı dene. Tarayıcıdan `/wallet` adresini açan ziyaretçiler `404` alır. Aşağıdaki komut `{"connected":true}` döndürürse Windows API, PHP ve veritabanı bağlantısı çalışıyordur.

```powershell
$walletSetup = Join-Path $env:LOCALAPPDATA 'STech-Kiosk-Sunucu\wallet-api.env.pending'
node "--env-file=$walletSetup" apps/api/dist/apps/api/src/migrate-wallet.js --check
```

`WALLET_BALANCE_WRITE_ENABLED=true` ile taşınan ve tamamlanmayı bekleyen bakiye düzenlemeleri, mevcut PanCafe köprüsünün bakiye iznini ve işlem kimliği denetimini kullanır. Yeni PanCafe bakiye düzenlemeleri için S TECH yönetim panelini kullan.

## Temiz başlangıç

Boş Wallet veritabanını bir kez başlat.

```powershell
node "--env-file=$walletSetup" apps/api/dist/apps/api/src/migrate-wallet.js --initialize-empty
```

Başarılı sonuçtan sonra ayar dosyasının adını `wallet-api.env` yap. Aktif POS işlemlerini bitir, API zaten çalışıyorsa durdur ve S TECH Başlatıcıdan normalde kullandığın seçeneği aç. Durum ekranında **Wallet MySQL** sonucunu kontrol et.