# PanCafe — 2.stech test kurulumu

Hedef dosya: `D:\Pan Group\Data\USDB.DAT`. İşletme adı **2.stech**; doğrulanan test üyesi **2 / kaan2**. Önceki "stech adlı üye" yorumu yanlıştı. Güncel inceleme kopyasında kaan2'nin bakiyesi ve bonusu 0,00 TL olarak okundu.

## Bağlantı aracı

Güncel araç `D:\stech-build-cache\pancafe-history-bridge\PanCafeBridge.exe` yolundadır. Masaüstündeki **S TECH - PanCafe Baglantisi** kısayolu bu aracı açar. Windows yönetici onayını operatör verir; Windows hizmeti kurulmaz. PanCafe uygulamasının kendisini yeniden açmak gerekmez.

PanCafe işlemi elevated, geliştirme ortamı standard yetkiyle çalışmaktadır. Standard okuyucunun canlı dosyaya bağlantısı Firebird'ün `Database is probably already opened by another engine instance in another Windows session` hatasını vermiştir. 23 Ekim 2026 tarihinde yönetici yetkisiyle açılan bağlantı aracının `/health` yanıtı `connected: true` döndürdü. Canlı `/member` sorgusunda 2 / kaan2, bakiye 0,00 TL, bonus 0,00 TL ve aktif hesap durumu doğrulandı. Windows güvenlik ayarı ve Firebird kilit dosyası değiştirilmedi.

Aracın `connection.json` dosyası ve anahtarı yalnızca yerel backend içindir, mobil uygulamaya/git'e kopyalanmaz. Güncel geçmiş aracı `127.0.0.1:3002` üzerinde dinler; önceki kredi aracı 3003 kullanır. Backend yalnızca güncel araca bağlıdır. Tüm uçlar Bearer anahtarı ister. Genel SQL çalıştırma ucu yoktur. Pencere kapatılırsa bağlantı durur. 27 Ekim 2026'da canlı `/health` yanıtında `connected`, `transactionHistory` ve `sessionHistory` doğrulandı.

## Aynı kullanıcı adı ve şifre

- Login, PanCafe üye bilgileriyle doğrulanır. Başka kullanıcı adına ait mobil kayıt bu üyeye bağlanmaz.
- Başarılı PanCafe girişinden sonra backend yalnızca uygulama oturumları ve aynı üyeyi gösteren `cafe_member_links` kaydını oluşturur. Ayrı bir mobil şifre veya bakiye oluşturulmaz.
- Yeni kayıt önce PanCafe `MEMBERS` tablosuna eklenir. Kaynaktaki `MEMBERS_BI` trigger'ı numarayı üretir. Kullanıcı adı/şifre değiştirilmeden aktarılır; ilk bakiye, bonus, avans ve toplam kullanım alanları 0'dır. Kayıt öncesinde mevcut kullanıcı kontrol edilir; kaynak USERNAME primary key'i tekrar kaydı engeller.
- Kayıt/giriş mevcut üyenin parolasını veya bakiyesini değiştirmez. PanCafe'ye üye eklenip yerel oturum oluşturma sonradan başarısız olursa yeni bir üye yaratmak yerine aynı bilgilerle tekrar login yapılabilir.
- PanCafe'nin mevcut PASSWORD alanı yalnızca yerel araç içindeki giriş karşılaştırmasında okunur; HTTP yanıtına, loglara, mobil uygulamaya veya uygulamanın PostgreSQL veritabanına aktarılmaz. Üreticinin şifre saklama biçimi bu çalışma kapsamında yeniden tasarlanmaz. Aynı şifreyle gerçek PanCafe client girişinin operatörce denenmesi yayın öncesi gereklidir.
- Yerel PostgreSQL oturum, tercih ve işlem altyapısı içindir. PanCafe üyeleri için ayrı parola/`demo_members` kaydı oluşturulmaz. Açıkça etkinleştirilen temsili yükleme modunda yalnızca test bakiyesi için `demo_wallets` kullanılır; bu bakiye PanCafe bakiyesi değildir.

## Backend'i etkinleştirme

Araç gerçekten bağlantı hazır durumuna geldikten sonra API `.env` ayarları:

```dotenv
CAFE_ADAPTER=pancafe
PANCAFE_BRIDGE_CONFIG=D:/stech-build-cache/pancafe-history-bridge/connection.json
PANCAFE_PAYMENT_SIMULATION=true
PANCAFE_BALANCE_CREDIT=true
```

## Üye ve bakiye eşitlemesi (Cloud Firestore)

`wallet-stech` projesinde varsayılan Cloud Firestore veritabanını **Production mode** ile oluştur. `pancafeInstallations` koleksiyonuna kiosk veya mobil istemci erişimi verme. Yerel API için ayrı bir hizmet hesabına `Cloud Datastore User` rolü ver ve Application Default Credentials (ADC) kullan. JSON kimlik dosyası kullanılıyorsa dosyayı API'yi çalıştıran hesabın erişebildiği özel bir klasörde, depo dışında sakla.

1. PanCafe sunucusunda `scripts/inspect-pancafe.ps1 -Database '<PanCafe veritabanı yolu>' -MemberColumns` komutuyla `MEMBERS` tablosundaki sütun adlarını doğrula. Gerekirse mevcut Firebird istemcisi için `-ClientDirectory`, yerel derleme yolu için `-OutputDirectory` ver. Komut yalnızca sütun adlarını listeler.
2. `scripts/build-pancafe-bridge.ps1` ile köprüyü yeniden derle. Köprünün mevcut `connection.json` dosyasına `allowFirebaseSync: true` ve adres sütununu `firebaseAddressColumn` olarak ekle. Üye tablosunda T.C. kimlik sütunu varsa adını `firebaseNationalIdColumn` olarak ekle. Bu ayar verilmediğinde Firestore'daki `nationalId` alanı boş kalır. Köprüyü yeniden başlat.
3. PanCafe'ye bağlı yerel API'nin `.env` dosyasına aşağıdaki ayarları ekle. ADC zaten yapılandırıldıysa JSON dosyası satırı isteğe bağlıdır. Her `installationId` için tek eşitleme süreci çalıştır.

```dotenv
FIREBASE_SYNC_ENABLED=true
FIREBASE_PROJECT_ID=wallet-stech
GOOGLE_APPLICATION_CREDENTIALS=C:/private/wallet-stech-credentials.json
```

API açılışta ve sonraki her turdan yaklaşık 60 saniye sonra PanCafe üyelerini okur. Değişen profiller ve bakiyeler `pancafeInstallations/{installationId}/members/{memberId}` altında güncellenir. Kullanıcı adı, üye numarası, GSM, e-posta, T.C. kimlik numarası, adres, ad, soyad, üyelik durumu ve kuruş cinsinden bakiye/bonus bu kayıtlarda tutulur. `LASTNAME` alanı kart kimliği içeriyorsa sayısal/hex değer soyad olarak kullanılmaz. Şifre doğrulaması yerel PanCafe köprüsünde kalır. Üye kaydı kaynaktan tamamen silinirse Firestore kaydı ayrıca yönetilir.

`GET /api/v1/health` yanıtında `firebaseSync` alanı `pending`, `synced` veya `error` olur. Bağlantı hatasında sonraki tur güncel PanCafe verisini yeniden okur. Gerçek POS entegrasyonu, oturum geçmişi aktarımı ve Firebase Auth kurulumu bu adımın dışındadır.

Firestore konsolundan bakiye düzenlemesini açmak için Bridge yapılandırmasında `allowFirebaseBalanceWrite: true`, API'de `FIREBASE_BALANCE_WRITE_ENABLED=true` ayarla ve ikisini yeniden başlat. İlk tur PanCafe'den doğrulanmış başlangıç bakiyesini yazar. Sonraki düzenlemelerde üye belgesinde yalnızca `balanceKurus` alanını tam sayı olarak değiştir. API, son eşitlenen değerle arasındaki farkı güncel PanCafe bakiyesine uygular. Örneğin iki tarafta da 100 TL varken Firestore'da 150 TL yazılır ve PanCafe'de arada 1 TL harcanırsa, 50 TL'lik artış 99 TL'ye eklenir ve sonuç 149 TL olur. PanCafe yazma sırasında tekrar değişirse API aynı farkı aynı işlem kimliğiyle sonraki turda dener. Bakiye ve bonus sınırlarına uymayan işlemlerde güncel kaynak değeri geri yazılır. `balanceSync.status` alanı `pending`, `applied`, `conflict` veya `invalid` durumunu gösterir.

## Test ödemeleri

Üretim/staging korumaları devam eder. `ENVIRONMENT=development` ve ödeme sağlayıcısı `mock` kalır. Yukarıdaki iki bayrak ve bağlantı dosyasındaki `allowBalanceCredit: true` ile ödeme temsili, PanCafe bakiye aktarımı gerçektir. En az 50 TL; 200 TL ve üzeri %10 bonus. Ana kart gerçek PanCafe bakiyesini gösterir; ayrı test bakiyesi dönmez. Ödeme başarılı doğrulandıktan sonra kaynak Firebird'de BAKIYE tutar+bonus kadar, AVAILBONUS bonus kadar artırılır. Bonus ana bakiyeye ikinci kez eklenmez. MEMBERSHISTORY kaydı ve yeni STECH_MOBILE_CREDITS ödeme makbuzu aynı transaction içinde yazılır. Aynı ödeme numarası farklı parametreyle reddedilir; tekrar çağrı bakiye eklemez. Kaynak DOUBLE alanlar DECIMAL(18,2) üzerinden hesaplanır.

PANCAFE_BALANCE_CREDIT kapalı tutulursa önceki ayrı deneme bakiyesi modu kullanılabilir. Ödeme hedefi `payment_orders.transfer_target` içinde saklanır. İşleyiciler sadece kendi hedeflerindeki işleri alır: eski ayrı test ödemeleri yeni moda geçince gerçek bakiyeye taşınmaz. İmzalı gerçek ödeme sağlayıcısı ve üretici tarafından desteklenen üretim entegrasyonu yayın öncesinde ayrıca gereklidir.

## İşlem ve PC oturum geçmişi

Ana bakiye modunda işlemler artık yerel ödeme tablosundan üretilmez; kaynak MEMBERSHISTORY okunur. Kasa yüklemeleri, bonus aktarımları ve kasa çıkışları PanCafe'nin doğrulanan kayıt metinleriyle ayrılır. Negatif tutarlar harcamadır; pozitif maliyet kayıtları yalnızca önceki kaynak bakiyesi aynı tutarda azalmışsa negatife çevrilir. Bilinmeyen hareketler "Diğer" altında kaynak açıklamasıyla görünür. Sıfır tutarlı hesap oluşturma kayıtları finansal geçmişe eklenmez. Mobil kayıtlar kaynak makbuzuyla eşleştirilip yükleme/bonus olarak bir kez ayrılır; yerel ödeme kayıtlarıyla tekrar birleştirilmez.

`GET /api/v1/me/transactions` doğrulanmış kullanıcının geçmişini ID tabanlı cursor ile sayfalar; her sayfada en fazla 100 kaynak kayıt vardır. Dashboard aynı kaynağın son sayfasını kullanır. `GET /api/v1/me/session-history` tamamlanmış SESSIONS kayıtlarını MEMBERID ile okur; terminal, başlangıç/bitiş, kullanım dakikası ve USINGPRICE ayrı "PC oturum ayrıntıları" bölümünde gösterilir. Oturum ücretinden tahmini kalan bakiye hesaplanmaz, sipariş ücretleri PC kullanım ücretine eklenmez ve oturum kayıtları finansal deftere tekrar eklenmez. Her iki kaynakta da güncel üye numarası ve kullanıcı adı doğrulanır.

Canlı kaans geçmişinde iki kasa yüklemesi (100+100 TL) ve mobil 200+20 TL doğrulandı. Canlı tamamlanmış PC oturumu henüz yoktur. Oturum okuma, kimlik ayrımı, 120 kayıtlık pagination ve makbuz eşleşmesi ayrı veritabanı kopyasında test edildi; bu testler canlı bakiyeyi değiştirmedi. PanCafe penceresi Computer Use'a görünmediğinden canlı PC oturumu arayüzden başlatılamadı.

Kaynak para alanları DOUBLE'dır; SQL projeksiyonunda DECIMAL(18,2), backend'de ondalık metinden integer kuruş dönüşümü kullanılır. AVAILBONUS, BAKIYE'ye ikinci kez eklenmez; PanCafe'deki harcama davranışı ayrıca doğrulanmalıdır.

## Doğrulama

- `pancafe-reader.test.ts`: para dönüşümü, üye numarası/adı birlikte kontrolü, hata durumunda demo/sıfır bakiye üretmeme.
- `pancafe.test.ts`: PanCafe bilgileriyle giriş, aynı kullanıcı adı bağlantısı, canlı okumayı taklit eden değişen bakiye, farklı üyelerin ayrılması, aynı bilgilerle kayıt, ayrı bakiye/parola kaydı oluşturmama ve anahtar/parola sızıntısı koruması.
- `TestPanCafeMemberWriter.cs`: yalnızca yeni oluşturduğu ayrı veritabanı kopyasında üye ekleme, şifre aktarımı, UTF8 ad, sıfır bakiye, mükerrer kayıt ve başarısız işlemin rollback testi. Canlı PanCafe'ye bu test tarafından üye eklenmedi.
- `TestPanCafeBalanceWriter.cs`: veritabanı kopyasında 200+20 TL bakiye, bonus, tek geçmiş kaydı, tekrar çağrı, parametre çatışması, yanlış üye ve geçmiş yazımı başarısız olduğunda bakiye/makbuzun birlikte geri alınması geçti. Canlı üyeye bu test tarafından para eklenmedi.
- Gerçek çalışmakta olan PanCafe ile elevated bağlantı ve 2 / kaan2 üyesinin canlı okunması doğrulandı. Gerçek kullanıcı bilgileriyle login, yeni üyenin PanCafe ekranında görünmesi ve gerçek client'ta giriş henüz doğrulanmadı.
