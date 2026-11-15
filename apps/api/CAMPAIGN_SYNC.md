# Admin → Wallet → kiosk kampanyaları

Admin kampanya düzenlemelerinin kaynağıdır. Kayıt, audit kaydı ve kalıcı gönderim kuyruğu aynı SQL transaction'ında yazılır. Wallet dağıtım noktasıdır. Kiosk kampanyaları S TECH API üzerinden okur.

Kiosk yükleme ekranında otomatik en yüksek bonus veya belirli kampanya seçilebilir. Kimlik doğrulamalı `POST /api/v1/kiosk/quote`, tutarı ve isteğe bağlı `promotionId` alanını kabul eder; tarih, minimum tutar ve bonus üst sınırını sunucuda doğrular. Bu yalnızca hesaplama önizlemesidir: POS entegrasyonu olmadan ödeme veya bakiye yazma yetkisi vermez. Hesaplama beklenirken/hata durumunda sahte 0 bonus gösterilmez.

Wallet yolu: `pancafeInstallations/{installationId}/promotions/{campaignId}`. Başlık, açıklama, koşullar, başlangıç/bitiş, minimum tutar (kuruş), bonus yüzdesi, maksimum bonus (kuruş), renk ve aktiflik aynen taşınır. Ayrı `promotionSyncReceipts` koleksiyonu tekrar gönderilen eski bir işlemin yeni sürümü ezmesini engeller. Pasife alma silme yerine `active=false` olarak eşitlenir. API yalnızca aktif ve geçerlilik aralığındaki kampanyaları gösterir.

API, Wallet bağlantısı yapılandırıldığında kampanyaları eşitler. İsteğe bağlı WALLET_CAMPAIGN_INSTALLATION_ID değeri yoksa PanCafe köprüsünün kurulum kimliğini kullanır. İnternet kesilince yerel kayıt ve gönderim kuyruğu korunur.

Admin listesi gönderim bekliyor/eşitlendi/bağlantı kapalı durumlarını gösterir. API health çıktısındaki `campaignSync` tüm eşitleme döngüsünün durumudur. İlk geçişte daha önce admin tarafından kaydedilmiş kampanyalar kuyruğa alınır; demo seed kayıtları kendiliğinden diğer sunuculara yayımlanmaz. Bunları yayımlamak için adminden kaydet.

Kontroller:

- `npm run typecheck` ve API `test/promotion-sync.test.ts`, `test/admin.test.ts`, `test/firebase-sync.test.ts`, `test/pancafe.test.ts`.
- Kiosk: `npm run test:campaigns`. Gerçek Electron'da bağlı mod ile ekleme, otomatik yenileme, renk, tutar, açık detayda düzenleme ve pasife alma kontrol edilir.

Mevcut A ve B bilgisayarlarını birlikte güncellemek için GitHub sürümünden `B-PanCafe-Kur.cmd` dosyasını yeniden indirip B'de çalıştır. Kiosku yetkili PIN ile kapat ve B'nin bu kurulumda ürettiği `A-Kiosk-Kur.cmd` dosyasını A'da çalıştır. A dosyası, oluşturulduğu sürümün EXE adresini ve SHA-256 değerini taşır. Eski A dosyasını tekrar çalıştırmak eski EXE'yi geri yükleyebilir.
