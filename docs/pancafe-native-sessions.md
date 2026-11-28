# Kiosktan PanCafe arka plan işlemleri

28 Kasım 2026 geçişi: bakiye, bilet ve üye oturumu istekleri artık PanCafe ekranını sürmez. `PanCafeBridge.exe`, Controller 2.4.1'de doğrulanan çekirdeğin projeye alınmış sürümünü kullanır. Ayrı `PanCafeController.exe` çalıştırılmaz. Kiosk ve API'nin mevcut HTTP yolları, kimlik doğrulaması, işlem kimlikleri ve sonuç kodları korunmuştur.

## Çalıştırma ve güncelleme

PanCafe sunucusunda `S-TECH-Baslat.cmd` ile normal sunucu açılışını yap. Başlatıcı, `scripts/PanCafeBackend` dahil kaynakların özetini kontrol eder; değişmiş köprüyü derler ve mevcut güncelleme akışından geçirir. Yalnızca bağlantı aracını elle güncellemek için `scripts/Kopru-Derle.cmd` kullanılabilir. PanCafe'nin yeniden başlatılması gerekmez.

Köprü x86 .NET Framework uygulamasıdır ve aynı Windows oturumundaki PanCafe ile gereken yönetici izniyle çalışır. PanCafe açık kalır; seçili sekme, ekran konumu, pencerenin önde olması ve son 3 saniyelik fare/klavye hareketsizliği koşulu yoktur. Üye düzenleme veya modal işlem sürüyorsa veri tutarlılığı için komut reddedilebilir. Mouse/klavye otomasyonuna dönüş yolu bulunmaz.

Doğrulanan PanCafe **3.3.2.312**, `pncserver.exe` SHA-256:
`017A4B0243778C119493C9FD80C5B5B4AF5EBF3E9199601B7583E90F6C0FA352`.
Farklı exe, beklenmeyen işlev imzaları veya çalışan uygulamayla eşleşmeyen `databasePath` / `clientDirectory` yapılandırması yazmadan reddedilir. Dosya yolu sabit bir kullanıcı adına veya C: sürücüsüne bağlı değildir.

Native DLL ve protokol profili köprü exe'sine gömülüdür; çalışma anında Node.js gerekmez. Derleme mevcut Node.js ve Windows .NET Framework derleyicisini kullanır. HTTP `/health` nesnesindeki `nativeBackend: "stech-native-v1"` güncel köprüyü ayırt eder; bu alan tek başına canlı bir para/oturum işleminin başarı kanıtı değildir.

POS öncesi `/credit/readiness`, otomatik bonus ayarına ek olarak native kaynakların, çalışan exe sürümünün ve kurulum yollarının uygunluğunu yazmadan kontrol eder. Bağlantı hazır değilse ödeme başlatılmaz; neden mesajı API üzerinden kioska iletilir.

## Bakiye yükleme

`POST /credit`, kuruş cinsinden `amount`, `bonus`, doğrulanmış `memberId`/`username` ve UUID `operationId` alır. Üye kimliğini kiosk yerine backend belirler. Eski sınırlar (en az 1 TL, ödeme en fazla 10.000 TL, bonus en fazla 1.000 TL) korunur.

Geçici, yalnızca PanCafe ana iş parçacığına bağlı `WH_GETMESSAGE` kancası özel komutu işler. Bu bir mouse, klavye veya kontrol tıklaması değildir. DLL, üye nesnesini kimlikle çözer, operatör yetkisini ve açık oturum bağlantısını doğrular. C# tarafı aynı sırada Firebird işlemini yürütür. PanCafe modelinin değişmemesi için ana iş parçacığı yalnızca bu kısa transaction boyunca bekler; hata ve süreç kapanışı için bırakma yolu vardır.

`MEMBERS.BAKIYE`, `TOTALBAKIYE`, `MEMBERSHISTORY`, `KASAHAR` ve `STECH_MOBILE_CREDITS` makbuzu tek transaction içinde yazılır. Sonra PanCafe üye modeli, açık üye listesi ve varsa terminal modeli kendi yenileme işlevleriyle güncellenir. SQL ile RAM sonucu doğrulanmadan başarı dönmez. Oturumdaki üyeye yükleme desteklenir.

Mevcut kiosk davranışındaki gibi `amount + bonus` ana bakiyeye tek kez eklenir; makbuzda ödenen tutar ve bonus ayrı tutulur. PanCafe'nin otomatik üye bonusu (`mbr_bonus_active`) kapalı olmalıdır. `AVAILBONUS` / `USEDBONUS` alanlarına ayrıca ekleme yapılmaz. Eski UI akışının toplam tutarı kasa yüklemesi olarak kaydetme davranışı korunur; ödeme yöntemi bu değişiklikte yeniden tasarlanmadı.

`STECH_LIVE_CREDIT_INTENTS.NATIVE_BACKEND` sütunu köprü başlangıcındaki mevcut şema hazırlama adımında eklenir. Yeni native girişimler `1`, eski UI girişimleri `0` olarak ayrılır. Eski tamamlanmış makbuzlar aynen döner. Eski sonucu belirsiz UI yüklemeleri otomatik native yüklemeye çevrilmez; önce tarihçe kanıtı aranır. Açık operatör yeniden denemesi de eski satışın yapılmadığının mevcut kontrollerine tabidir.

Yeni akışta para ve son makbuz atomik olduğundan yanıt kaybolsa da aynı işlem tekrar para eklemez. Gerekirse mevcut makbuz kullanılarak yalnızca RAM yeniden eşitlenir. `credit_ui_review` adı HTTP uyumluluğu için kalmıştır; artık bir UI otomasyonunu ifade etmez.

## Biletle yükleme

`POST /tickets/redeem`, aynı backend üzerinden çalışır. Bilet satışı penceresi açılmaz. Biletin kimliği, barkodu, fiyatı, son kullanma tarihi, kullanım durumu ve üyeye ait önceki makbuzu kontrol edilir. Bilet yüklenirken üyenin bilgisayar oturumu kapalı olmalıdır; otomatik PanCafe üye bonusu da kapalı olmalıdır.

Yeni biletin `SOLD=1 / USED=1` kaydı, ana bakiye artışı, üye hareketi, `ISLEM=8` bilet kasa satışı ve `STECH_TICKET_CREDITS` makbuzu aynı transaction içindedir. Önceki bilet akışındaki `TOTALBAKIYE` davranışı korunur. Eski UI yolunda satılıp yüklemesi yarım kalmış bilet, aynı üyenin kalıcı talebi ve tam bir kasa satış kanıtı varsa mevcut satışı kullanır; ikinci kasa kaydı eklenmez. Tekrar okutulan bilet başka üyeye veya aynı üyeye ikinci kez yüklenmez.

PanCafe'nin bellekteki `TTicket` nesnesi ve açık bilet dataset'i de kendi yenileme işlevleriyle güncellenir. Bu ekleme S TECH protokol profilini **5** yapar; Controller'ın kendi dosyaları değiştirilmemiştir.

## Bilgisayara oturma

`POST /sessions/start` önce aynı UUID'nin kalıcı kaydını kontrol eder. Mevcut kiosk 10 TL başlangıç koşulu, üye/masa sahipliği ve doluluk kontrolleri korunur. Sonrasında PanCafe'nin gerçek `TTerminal.StartSession` işlevi bir kez çağrılır. Tarife, açılış ücreti, sayaç ve istemci bildirimi PanCafe tarafından uygulanır; bunları taklit etmek için `TERMINALS` tablosuna SQL yazılmaz.

Kapalı fiziksel terminal de bu çağrıya ulaşır. PanCafe'nin kendi `doSessionStarted` yolu, kayıtlı MAC ve `cli_use_wakeuponlan` ayarıyla Wake-on-LAN gönderir. Kiosk katmanı ayrıca WOL göndermez. PanCafe WOL yordamı için geçerli, güncel MAC kaydı gerekir; yalnızca IP günlüğünde bulunan veya iki nokta ile yazılmış adres kullanılmaz.

İstemci henüz bağlanmadıysa `waking` döner. Köprü ve `GET /sessions/status` yalnızca native durum okuma komutunu (4) kullanır. Ana iş parçacığı veya işlem kilidi bilgisayarın açılması boyunca tutulmaz; başka üyelerin yüklemeleri araya girebilir. Fiziksel oturum ancak doğru üye/terminal ve gerçek native socket bağlantısı doğrulandığında `started` olur. Sanal masa için socket beklenmez.

En fazla 3 dakika beklenir. Zaman aşımı veya sonucu belirsiz başlatma `review` olur; tekrar `StartSession` veya açılış ücreti gönderilmez. Aynı işlem kimliği ya da başka kimlikle aynı üye/masa için otomatik ikinci açılış engellenir. `Status` bilinmeyen işlem için `not_started` döndürür ve başlatma yapmaz. Köprü yeniden açıldıktan sonra kalıcı kayıt üzerinden durum sorgulanabilir.

## Kayıtların korunması

Köprü yanındaki `session-operations` klasörünü, PanCafe'deki `STECH_*` makbuz tablolarını ve `%LOCALAPPDATA%\STech\PanCafe\Operations` günlüklerini koru. Belirsiz işlemler için bu kayıtlar silinip yeniden ödeme/oturum gönderilmez; yetkili PanCafe'deki gerçek sonucu inceler. DLL kopyaları `%LOCALAPPDATA%\STech\PanCafe\Native` altında içerik özetiyle tutulur. İşlem veritabanı yolu her günlükte bulunur; başka kurulumun kaydı aynı üyenin işlemi sayılmaz.

## Doğrulama

```powershell
.\scripts\build-pancafe-bridge.ps1 -OutputDirectory .\.data\pancafe-native-build
.\scripts\test-pancafe-native.ps1 -BackupPath 'C:\yedek\tutarli-yedek.fbk' -ClientDirectory 'C:\PanCafe\Core'
npm run typecheck -w @stech/api
npm test
npm run build:api
```

Testler mevcut canlı DAT dosyasını kopyalamaz. Tutarlı Firebird `.fbk` yedeğini yeni geçici veritabanlarına geri yükler. Eski `TestPanCafeBalanceWriter.cs` / `TestPanCafeTicketCredit.cs` yerine tek `test-pancafe-native.ps1` giriş noktası ve daha kapsamlı `BridgeIntegrationTests.cs` kullanılır. Native protokol, gerçek üretilen DLL'nin kendi test sürecindeki fiziksel terminal/bilet nesneleri, SQL rollback, bonus ayrımı, işlem tekrarı, kayıp yanıt, eski kayıt geçişi ve socket bekleme doğrulanır. Test fixture profili canlı PanCafe'ye bağlanamaz ve üretim exe'sine dahil edilmez.

Bu geçişte canlı kullanıcıya test parası yüklenmedi, bilet tüketilmedi veya gerçek oturum açılmadı. Controller 2.4.1'in temel fiziksel oturum yolu kullanıcı tarafından daha önce doğrulandı; bu S TECH entegrasyonu ve yeni native bilet yolu için son kontrol gerçek kiosk üzerinden yapılmalıdır.
