# Kiosktan sanal PanCafe oturumu

Bağlantı, Türkçe PanCafe Pro **v3.3.2** yönetim ekranında doğrulandı.
Yalnızca `ISVIRTUAL=1` olan sanal masalarda üye oturumu açar. Fiziksel
bilgisayarı açma veya istemci kilidini kaldırma desteği içermez.

## Yerel bağlantı

`connection.json` içinde `allowVirtualSessionStart: true` açıkça etkinleştirilir.
Varsayılan kapalıdır. Güncel bridge için `scripts/build-pancafe-bridge.ps1`
kullanılır. Bridge ile API aynı yapılandırmayı okumalıdır. PanCafe yönetim
ekranı Windows oturumunda açık ve kullanılabilir olmalıdır. Bridge, PanCafe
ile aynı Windows oturumunda ve gereken Windows yönetici izniyle çalışır.
İşlem sırasında yönetim ekranındaki menüleri veya üye seçimini değiştirmeyin.

Kiosk, cihaz anahtarı ve giriş yapan üyenin erişim tokenıyla
`POST /api/v1/kiosk/computers/:id/start` çağırır. Gövde yalnızca UUID v4
`operationId` içerir. Üye numarası ve kullanıcı adı backend tarafından mevcut
PanCafe eşleştirmesinden alınır; istemci başka bir üyeyi seçemez.

“Durumu kontrol et”, `GET /api/v1/kiosk/computers/:id/start/:operationId`
üzerinden mevcut kaydı sorgular; yeni açılış isteği göndermez. Başlatılmamış
işlem için `not_started` döner ve kiosk yeniden seçim yapılmasına izin verir.
PanCafe ekranına erişim açılıştan önce başarısız olursa işlem `failed` olarak
kaydedilir ve kullanıcıya ilgili açıklama gösterilir.

## Arka plan girdisi

Köprü, PanCafe ekranını önce yalnızca pencere mesajlarıyla sürer: fare imleci
oynamaz, klavye odağı ve öndeki pencere değişmez. Masa seçimi, sağ tık menüsü,
üye araması ve onay bu yolla gönderilir. PanCafe bu mesajları kabul etmezse ve
henüz onay gönderilmediyse açılan menü/pencere kapatılır ve işlem bir kez
gerçek fare/klavye girdisiyle (önceki yöntem) yeniden denenir. Onay mesajı iki
saniyede üye penceresini kapatmazsa onay gerçek Enter tuşuyla verilir.
Kullanılan yöntem işlem kaydına `InputMode` (`background` / `foreground`)
olarak yazılır. `STECH_PANCAFE_FOREGROUND_INPUT=1` ortam değişkeni köprüyü
doğrudan önceki yönteme zorlar.

Her iki yöntemde de PanCafe yönetim ekranında **Genel** sekmesi açık olmalıdır;
terminal listesi ve günlük paneli yalnızca o sekmede bulunur. Arka plan
yöntemi 13 Kasım 2026'da yazıldı; canlı PanCafe üzerinde henüz doğrulanmadı.
`scripts/Kopru-Derle.cmd` köprüyü derler, eski exe'yi yedekler ve yenisini açar.

## Doğrulama ve tekrarlar

Bridge, doluluk ve mevcut üye oturumunu kontrol eder. PanCafe'nin terminal
listesinden doğru masayı seçip üye oturumu açma penceresinde kullanıcı adını
arar. Arama sonucunun karışmaması için aynı adı içeren başka bir kayıt varsa
işlem kasaya yönlendirilir. Farklı PanCafe sürümü veya pencere düzeninde
işlem güvenli biçimde durur.

Oturum başlatılırken `TERMINALS` tablosuna doğrudan yazılmaz. Açılış ücreti,
tarife, sayaç ve bakiye düşümü PanCafe'nin kendi işlemiyle uygulanır.
Başarı için hem terminalin doğru üyeyle açılması hem de PanCafe'nin yeni
yerel günlük olayı doğrulanır. Backend başarıyı `kiosk.session.started`
yönetim kaydıyla saklar.

`session-operations` klasörü bridge yanında kalıcı tutulmalıdır. Yeni
bridge sürümüne geçerken bu klasör korunur. Aynı işlem kimliği tekrar
gönderildiğinde yeniden oturum açılmaz. Sonucu belirsiz kalan işlem için
otomatik yeni açılış yapılmaz; başka bir kimlikle aynı üye/masaya açılış da
engellenir. Sonuç bir dakikadan sonra eski bir günlük olayıyla otomatik
eşleştirilmez. Böyle bir durumda PanCafe yönetim ekranı ve işlem kaydı
yetkili tarafından incelenmelidir; belirsiz kayıt silinerek yeniden denenmez.

## Doğrulanmış test

11 Kasım 2026'da paketlenmiş kiosk üzerinden PC-1, `kaans` (üye no 1)
adına açıldı. PanCafe terminal durumu ve yeni yerel günlük kaydı birlikte
doğrulandı. Aynı isteğin tekrarı yeni oturum veya ek bakiye düşümü yaratmadı.
Mevcut PanCafe tarifesi denemede **10 TL açılış ücreti** uyguladı.

`kiosk/scripts/live-computer-start.cjs` gerçek oturum açan, açıkça etkinleştirme
gerektiren test aracıdır. Normal test komutunun parçası değildir.
