# PanCafe bağlantı doğrulaması — 23 Ekim 2026

**Güncel uygulama ve kullanım talimatı:** [PANCAFE_SETUP.md](PANCAFE_SETUP.md). Aşağıdaki ilk inceleme notları tarihçedir. Hedef: **2.stech**, üye **2 / kaan2**. Canlı bağlantı doğrulandı; kayıt, giriş, okuma ve tekrara dayanıklı bakiye yazma adaptörü mevcut. Güncel yerel modda ödeme temsili, PanCafe bakiye aktarımı gerçek olacak şekilde açıldı. Native kredi işlemi veritabanı kopyasında doğrulandı; canlı üyeye kullanıcı tarafından yapılacak ilk yükleme henüz denenmedi.

## Son inceleme: doğrudan veritabanı bağlantısı

Kullanıcı doğrudan veritabanı bağlantısını istedi. `scripts/PanCafeReadOnly.cs` ile kurulu Firebird 2.5 x86 motoru üzerinden yalnızca SELECT kabul eden okuyucu hazırlandı. Her sorgu READ ONLY / NO WAIT transaction içinde çalışır; bağlantı trigger'ları ve garbage collection kapatılır. Windows güvenlik ayarları değiştirilmedi. Bu, üreticinin resmî API entegrasyonu değil, yerel geliştirme için incelenen veritabanı erişimidir.

- `D:\Pan Group\Data\USDB.DAT` dosyasının ayrı inceleme kopyasında `MEMBERS` ve `MEMBERSHISTORY` tabloları okundu.
- `MEMBERS.ID`, `USERNAME`, `BAKIYE` ve `AVAILBONUS` alanları doğrulandı. Para alanları Firebird'de DOUBLE olduğundan okuyucunun sorgusunda DECIMAL(18,2) olarak alınır ve backend'de ondalık metinden integer kuruşa dönüştürülür; kaynak şema değiştirilmez.
- İnceleme kopyasında `ID=1 / USERNAME=kaans`, bakiye 0,00 ve bonus 0,00 okundu. `ID=2 / stech` bulunmadı.
- Kullanıcı hedefin farklı kurulum/kayıt olduğunu bildirdi. Doğru kurulumun yolu istenmiştir; önceki dosya hedef olarak yapılandırılmadı.
- İlk kurulumun canlı dosyasına READ ONLY bağlantı şu hatayla reddedildi: `Database is probably already opened by another engine instance in another Windows session`. Erişim engelini kaldırmak için güvenlik ayarı değiştirilmedi; uygulama kapatılmadı ve kilit dosyası silinmedi.
- `apps/api/src/cafe/pancafe-reader.ts` yalnızca kontrollü okuma ve üye kimliği doğrulama için hazırdır; çalışma zamanı adaptörü olarak henüz etkin değildir. Hatalarda sıfır/demo bakiye döndürmez. Bonus bakiyesini ana bakiyeye otomatik eklemez; PanCafe harcama semantiği doğrulanmalıdır.

Doğru yol bilindiğinde `scripts/inspect-pancafe.ps1 -Database <tam-yol> -MemberId <numara> -ExpectedUsername <ad>` ile iki alan birlikte doğrulanabilir. Bu araç üye eşleştirmesini kendiliğinden etkinleştirmez. Önce canlı okuma ve para birimi/bonus anlamı doğrulanmalı, sonra yalnızca doğrulanmış mobil hesaba bağlanmalıdır. PanCafe'ye bakiye yazma ve mobil kayıtların PanCafe'de otomatik oluşturulması henüz uygulanmamıştır.

## Önceki API araştırması

## Sonuç

**PanCafe bağlantısı henüz doğrulanmadı ve etkinleştirilmedi.** Localhost uygulaması geliştirme adaptörüyle çalışır; ekrandaki bakiye PanCafe bakiyesi değildir.

## Doğrulananlar

- Bilgisayarda `D:\Pan Group` altında PanCafe kurulumu bulunuyor.
- `Data\USDB.DAT` veri dosyası ve `Core\fbembed.dll` Firebird bileşeni mevcut. Bu dosyalar üzerinde yazma işlemi yapılmadı.
- `pncserver.exe` süreçleri çalışıyor. İncelemede bir sürecin 34285, 34286 ve 34287 TCP portlarını dinlediği görüldü. Bu portların HTTP API veya desteklenen entegrasyon servisi olduğu doğrulanmış değildir.
- Kurulum kökü ve Tools dizininde API/SDK belgesi bulunamadı. Bu, üreticinin özel bir entegrasyon sağlamadığı anlamına gelmez.
- Resmî site üye bakiyesi, bonus ve raporlama özelliklerini açıklıyor: https://www.pancafepro.com/ . İncelenen resmî sayfalarda üçüncü taraf üye sorgulama/kredi yükleme sözleşmesi bulunamadı.
- Windows Computer Use envanteri PanCafe'yi çalışan uygulama olarak gösteriyor, fakat yönetim penceresi döndürmüyor. Açma girişimi `accessibility window-opened handler did not become ready` hatasıyla sonuçlandı; tekrar pencere envanterinde de PanCafe penceresi görünmedi.

## Kullanıcının bildirdiği test hedefi

- Kullanıcı adı: `kaans`
- PanCafe üye numarası: `1`
- Bu iki bilginin aynı PanCafe üyesine ait olduğu henüz uygulama ekranından veya desteklenen bir sorguyla bağımsız doğrulanamadı.
- Hiçbir mobil hesaba aktif eşleştirme kaydı atanmadı. PanCafe bakiyesi okunmuş gibi gösterilmedi ve kredi yüklenmedi.

## Bağlantı kurulabilmesi için gerekenler

Üreticiden desteklenen API, SDK veya yerel entegrasyon yöntemi edinilmeli. Özellikle aşağıdakiler belgelenmeli:

1. Üye numarasıyla üye ve güncel bakiye okuma; tutarın para mı süre kredisi mi olduğu.
2. Güvenilir kullanıcı doğrulama veya hesap bağlama yöntemi.
3. Üye oluşturma desteği ve kullanıcı adı çakışması davranışı.
4. Kredi yükleme, dış işlem referansı, işlem sonucu sorgulama ve yinelenen isteklerde davranış.
5. Bonusun PanCafe'de mi backend'de mi uygulandığı; iki kere bonus verilmemesi.
6. Şube/kurulum kimliği, yetkiler ve test ortamı erişimi.

Yerel bağlantı servisi bu sözleşmeyi uygular. Backend eşleştirmesi en az `installationId + cafeMemberId` içermeli; mobil kullanıcı adı tek başına sahiplik kanıtı değildir. Kaynak bakiye PanCafe'de kalır. Gerçek kafe kurulumu test kurulumundan ayrı eşleştirilir; test bakiye ve işlem kayıtları taşınmaz.

## Üreticiye iletilebilecek soru taslağı

> PanCafe Pro kullanan bir işletme için mobil üyelik ve online kredi yükleme entegrasyonu geliştiriyoruz. Üye numarasıyla bakiye/işlem okuma, üye oluşturma ve dış işlem referansıyla mükerrer kredi yüklemeyi önleyen yazma işlemleri için desteklediğiniz API, SDK veya yerel servis var mı? Varsa dokümantasyon, erişim koşulları ve test ortamı bilgilerini paylaşabilir misiniz? Üye bonus sistemiyle entegrasyonda önerdiğiniz yöntem nedir?

Bu taslak üreticiye gönderilmedi.
