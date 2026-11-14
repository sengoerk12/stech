# Ödeal D2D POS bağlantısı

Kiosk sunucusu Ödeal'a ödeme sepetini gönderir. Sepetteki `externalDeviceKey` POS'taki **Cihazlarım** menüsünde kaydedilmiş kodla aynıdır. POS ödeme sonucunu HTTPS üzerinden bildirir. S TECH bildirimin anahtarını, sepet referansını ve kuruş tutarını eşleştirip mevcut bakiye kuyruğuna yazar.

1. PAX A910S'de Ödeal'ın D2D profili ve cihaz kodu tanımlanır. Bu kurulumun cihaz kodu `KIOSK1`.
2. API sunucusuna `apps/api/.env.example` içindeki Ödeal değişkenleri tanımlanır. İş yeri ve gizli anahtarlar sunucuda tutulur. Ödeal bildirim anahtarı ayrı bir rastgele anahtardır.
3. Ödeal'ın erişebileceği HTTPS adresinde `/api/v1/webhooks/odeal` yolları API'ye iletilir. Ödeal konfigürasyonundaki `paymentSucceededUrl`, `paymentCancelledUrl` ve `basketCancelledUrl` sırasıyla `/payment-succeeded`, `/payment-cancelled` ve `/basket-cancelled` son eklerine ayarlanır. `odealRequestKey` sunucudaki `ODEAL_REQUEST_KEY` ile aynı olmalıdır. Mevcut Ödeal konfigürasyonu kontrol edilip diğer alanları korunur.
4. Sepet tipi, vergi oranı (standart sepet için), il ve ilçe işletmeye uygun girilir. Ödeal konfigürasyonundaki sepet tipi sunucu ayarıyla eşleşmelidir.
5. `stage` için Ödeal test terminali ve test anahtarları gerekir. Test ödemeleri deneme bakiyesine gider. Güncel kiosk ile POS'a giden tutar, iptal ve onay işlemleri test edilir.
6. `live` için canlı anahtarlar, PanCafe yazma yetkisi ve `PANCAFE_BALANCE_CREDIT=true` gerekir. `PANCAFE_PAYMENT_SIMULATION=false` olarak ayarlanır.

POS'a gönderim belirsizse aynı terminalde yeni sepet açılmaz. Ödeal'daki sepet ve işlem raporu ödeme referansıyla karşılaştırılır. Ödeal konfigürasyonunda `paymentFailedUrl` için `/payment-failed` adresini de kaydedin. Ödeme denemesi başarısız bildirildiğinde backend ödenmemiş sepeti kapatır. POS'taki İptal düğmesi yalnızca ödeme ekranını kapatırsa kiosk ekranındaki **Ödemeyi iptal et** düğmesi aynı sepeti Ödeal'den kaldırır. Ödeal iptali doğruladığında kiosk yeni işleme geçebilir. Tahsilat sonrası iptal, yönetim kayıtlarına inceleme için yazılır. Aktarılmış PanCafe bakiyesi otomatik olarak geri alınmaz. Kaçırılan bildirimler Ödeal işlem raporuyla mutabakat gerektirir.

[Ödeal D2D](https://docs.odeal.com/entegrasyon/tr/api/d2d/whatisd2d) · [Bildirimler](https://docs.odeal.com/entegrasyon/tr/api/ortak-servisler/geri-bildirim)
