# S TECH admin · cPanel / PHP 7.4

Bu paket `https://stechespor.com/wallet/admin/` adresinde cPanel/MySQL üzerinde oturum açma, ödeme geçmişi, ödeme ayrıntısı ve gün sonu raporunu çalıştırır. A bilgisayarı kapanınca panel cPanel’deki son eşitlemeyi gösterir. Web paneli için kurulumda ayrı bir izleyici hesabı seçilir. Yerel hesaplar, bakiye düzenleme, kampanya ve kiosk tasarımı A’daki mevcut panelde kullanılmaya devam eder.

`git pull` ile gelen kaynaklardan cPanel ZIP ve SQL dosyalarını oluşturmak için proje klasöründe çalıştır:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\admin-cloud\Build-CloudAdminPackage.ps1
```

## 1. cPanel

1. **phpMyAdmin** ekranının solundan `stechespor_admin` veritabanını seç. **İçe Aktar** sekmesinden bu paketteki `admin-kurulum.sql` dosyasını çalıştır. Bu SQL yalnızca `stech_` ile başlayan dört yönetim/teslimat tablosunu ve Ödeal bildirim tablosunu oluşturur.
2. Dosya Yöneticisinde `public_html/wallet` klasörüne `cPanel-admin.zip` dosyasını yükle ve ayıkla. `public_html/wallet/admin/index.php` ve `public_html/wallet/admin/api.php` görünmeli. Dosya Yöneticisi Ayarlarından gizli dosyaları göstermeyi açıp `admin/.htaccess` dosyasının da çıktığını kontrol et. `wallet/index.php` mevcut Wallet API’sidir.

## 2. A bilgisayarı

1. A’daki `stech` proje klasöründe `git pull` yap. ZIP ile aktarıyorsan `A-Windows.zip` içindeki `proje` klasörünün **içeriğini** A’daki `stech` proje klasörüne kopyala.
2. A’da S TECH’i çalıştırdığın Windows kullanıcısıyla proje klasöründe PowerShell aç ve şu komutu çalıştır:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\admin-cloud\Configure-CloudAdmin.ps1
   ```

3. Webde kullanacağın yönetici adını ve en az 12 karakterli şifreyi seç. Sonra cPanel’deki veritabanı kullanıcısının tam adını ve şifresini gir. Şifreler PowerShell penceresinde gizli yazılır. Komut `%LOCALAPPDATA%\STech-Kiosk-Sunucu` içinde `hosted-admin.env` ile `stech-admin-cloud.php` dosyalarını oluşturur. Eski paketin oluşturduğu özel PHP dosyası varsa, `return [` bloğuna `db_user` alanıyla cPanel’deki tam veritabanı kullanıcı adını ekle.
4. `stech-admin-cloud.php` dosyasını cPanel’de **`/home/stechespor/stech-admin-cloud.php`** konumuna, `public_html` klasörünün bir üstüne yükle. İzni **600** yap. `hosted-admin.env` Windows’ta kalır.
5. Aktif POS işlemleri bittikten sonra A’da **S TECH Başlat → 7 → 2** yap. Sonra web paneline yeni seçtiğin web şifresiyle giriş yap. Genel bakışta **A’dan alınan son veri** saatini ve geçmiş ödemeleri gör. S TECH sunucusu kapalıyken aynı web hesabıyla yeniden giriş yapıp raporu doğrula.

## 3. Ödeal bildirimlerini siteye geçirme

Bu aşamaya web giriş ve rapor testi başarılı olduktan sonra geç. Aktif POS işlemleri bitince aşağıdaki adımları aynı bakım aralığında tamamla.

1. cPanel’de `/home/stechespor/stech-admin-cloud.php` içinde `'odeal_enabled' => false` satırındaki `false` değerini `true` yap. `odeal_request_key` ve `odeal_device` alanları A’daki `odeal-api.env` dosyasından hazırlanır.
2. Ödeal entegrasyonunda mevcut dört bildirim adresini şunlarla değiştir. Ödeal’ın doğrulama anahtarı A’daki mevcut ayarla aynı olmalı.

   - `https://stechespor.com/wallet/admin/odeal/payment-succeeded`
   - `https://stechespor.com/wallet/admin/odeal/payment-cancelled`
   - `https://stechespor.com/wallet/admin/odeal/payment-failed`
   - `https://stechespor.com/wallet/admin/odeal/basket-cancelled`

3. A’da `%LOCALAPPDATA%\STech-Kiosk-Sunucu\hosted-admin.env` dosyasında `HOSTED_ADMIN_ODEAL_RELAY=false` satırını `HOSTED_ADMIN_ODEAL_RELAY=true` olarak değiştir. **S TECH Başlat → 7 → 2** ile yeniden başlat. Güncel Windows API’si artık Ödeal yapılandırmasında yukarıdaki adresleri denetler. A, aldığı bildirimi mevcut PanCafe aktarım kurallarıyla işler.
4. İlk canlı ödemede POS onayı, web panelinde işlem ve PanCafe bakiyesini karşılaştır. Ödeal bildirim adresi doğru kaydedilmezse kiosk POS kontrolü hata verir. Önceki çalışma düzenine dönmek için Ödeal’daki dört bildirimi eski adreslerine, Windows’taki `HOSTED_ADMIN_ODEAL_RELAY` değerini `false`a çevirip A’yı yeniden başlat.

Sunucu, gelen bildirimi duruma göre saklar. A kapalıyken ulaştırılamayan bildirimler sırada kalır. A çalışmaya başladığında bunları alır. PanCafe’ye gönderilen işlem kimliği mevcut ödeme kimliğidir. Ödeal’dan hiç ulaşmayan bildirimlerin işlem raporuyla karşılaştırılması, mevcut Windows servisi çalışırken yapılır.

## İsteğe bağlı bakım görevi

Ödeme bildirimi ve A’ya aktarım için ayrıca Cron gerekmez. Süresi dolmuş web oturumlarını günlük temizlemek için Cron Jobs’a günde bir kez şu komut eklenebilir:

```sh
/usr/local/bin/php /home/stechespor/public_html/wallet/admin/maintenance.php
```

Web panelinde gün sonu raporu, S TECH’in kaydettiği canlı Ödeal yüklemelerini kapsar. A kapalıyken alınan ödeme, eşleşen kayıt sunucuya daha önce gönderildiyse bekleyen olarak görünür. A’nın henüz eşitlemediği bir ödeme kaydı A açıldığında listede görünür. Canlı PanCafe bakiyesi ve bilgisayar durumu A üzerinden güncellenir.
