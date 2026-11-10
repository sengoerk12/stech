# Admin → Firestore → kiosk kampanyaları

Admin kampanya düzenlemelerinin kaynağıdır. Kayıt, audit kaydı ve kalıcı gönderim kuyruğu aynı SQL transaction'ında yazılır. Firestore dağıtım noktasıdır; kiosk yalnızca kendi güvenli API'sinden okur, Firebase anahtarı taşımaz.

Kiosk yükleme ekranında otomatik en yüksek bonus veya belirli kampanya seçilebilir. Kimlik doğrulamalı `POST /api/v1/kiosk/quote`, tutarı ve isteğe bağlı `promotionId` alanını kabul eder; tarih, minimum tutar ve bonus üst sınırını sunucuda doğrular. Bu yalnızca hesaplama önizlemesidir: POS entegrasyonu olmadan ödeme veya bakiye yazma yetkisi vermez. Hesaplama beklenirken/hata durumunda sahte 0 bonus gösterilmez.

Firestore yolu: `pancafeInstallations/{installationId}/promotions/{campaignId}`. Başlık, açıklama, koşullar, başlangıç/bitiş, minimum tutar (kuruş), bonus yüzdesi, maksimum bonus (kuruş), renk ve aktiflik aynen taşınır. Ayrı `promotionSyncReceipts` koleksiyonu tekrar gönderilen eski bir işlemin yeni sürümü ezmesini engeller. Pasife alma silme yerine `active=false` olarak eşitlenir. API yalnızca aktif ve geçerlilik aralığındaki kampanyaları gösterir.

- `FIREBASE_SYNC_ENABLED=true`: Üye eşitlemesinin yanında kampanya eşitlemesi de başlar.
- `FIREBASE_CAMPAIGN_SYNC_ENABLED=true`: Ayrı admin API'sinde yalnız kampanya eşitlemesini açar.
- `FIREBASE_CAMPAIGN_INSTALLATION_ID`: Ayrı admin API'si aynı B kurulumunu hedefliyorsa onun kimliği; aksi halde mevcut köprü kurulum kimliği kullanılır. Üyelik eşlemesini değiştirmez.
- `FIREBASE_PROJECT_ID` ve `GOOGLE_APPLICATION_CREDENTIALS`: Sunucuya ait mevcut Firebase yapılandırması. Anahtarlar repoya veya kioska konulmaz.

İşçi 5 saniyede bir çalışır. Kiosk oturum açıkken 5 saniyede bir kampanyaları yeniler. Ayrı admin/B sunucuları ve ağ gecikmesi nedeniyle yayılım birkaç döngü sürebilir. İnternet kesilince yerel kayıt korunur; yeniden başlatma sonrasında da kuyruk tekrar denenir. Aynı kampanyanın başka sunucularda eşzamanlı düzenlenmesi durumunda son bulut yazımı geçerlidir. Aynı admin API'sindeki eski formlar revision kontrolüyle reddedilir.

Admin listesi gönderim bekliyor/eşitlendi/bağlantı kapalı durumlarını gösterir. API health çıktısındaki `campaignSync` tüm eşitleme döngüsünün durumudur. İlk geçişte daha önce admin tarafından kaydedilmiş kampanyalar kuyruğa alınır; demo seed kayıtları kendiliğinden diğer sunuculara yayımlanmaz. Bunları yayımlamak için adminden kaydet.

Kontroller:

- `npm run typecheck` ve API `test/promotion-sync.test.ts`, `test/admin.test.ts`, `test/firebase-sync.test.ts`, `test/pancafe.test.ts`.
- Gerçek Firestore testi: `STECH_FIREBASE_SMOKE_PROJECT` ve sunucu kimliği ayarlanarak `test/promotion-firestore.test.ts`. Rastgele adlandırılan ayrı test kurulumu kullanılır ve yalnız test belgeleri temizlenir.
- Kiosk: `npm run test:campaigns`. Gerçek Electron'da bağlı mod ile ekleme, otomatik yenileme, renk, tutar, açık detayda düzenleme ve pasife alma kontrol edilir.

Mevcut A ve B bilgisayarlarını birlikte güncellemek için GitHub sürümünden `B-PanCafe-Kur.cmd` dosyasını yeniden indirip B'de çalıştır. Kiosku yetkili PIN ile kapat ve B'nin bu kurulumda ürettiği `A-Kiosk-Kur.cmd` dosyasını A'da çalıştır. A dosyası, oluşturulduğu sürümün EXE adresini ve SHA-256 değerini taşır. Eski A dosyasını tekrar çalıştırmak eski EXE'yi geri yükleyebilir.
