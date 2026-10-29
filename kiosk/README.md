# S TECH Kiosk

Windows müşteri noktası. `kiosk.exe` açılınca tam ekran başlar. NFC kart girişi, ana ekran, bakiye yükleme, kampanya koşulları, sayfalı işlem/PC oturum geçmişi ve profil ekranları içerir. Mobil uygulamanın koyu tema, turuncu/mavi vurgu ve marka logosu korunmuştur. Minimum önerilen ekran 1024×768, yatay yön.

## Şu an ne çalışır?

- **Demo:** İki ayrı müşteri, kalıcı deneme bakiyeleri, POS onay/red senaryoları, bonus, tekrar onay koruması ve yarım kalan yüklemeye dönüş. Gerçek tahsilat / PanCafe yazımı yapılmaz. Kartlar `DEMO0001`, `DEMO0002`; ekrandaki demo butonları da aynı akışı açar.
- **PanCafe bağlantısı:** USB klavye modundaki okuyucu kimliği ve Enter gönderir. Backend cihaz anahtarını doğrular; Windows köprüsü kimliği `MEMBERS.LASTNAME` (soyadı) alanında arar. Tam bir eşleşme, aktif üyelik ve kaynak kimlik doğrulaması gerekir. Başta sıfırlar korunur. Birden fazla eşleşme veya bağlantı hatasında giriş verilmez. Bakiye, hareketler ve tamamlanmış PC oturumları mevcut API'den okunur. Soyadı sayısal/hex kart kimliği ise müşteri adına eklenmez.
- **Gerçek POS ödemesi henüz bağlı değildir.** Kullanıcının bildirdiği cihaz PAX 910S, ödeme uygulaması İş Bankası. USB bağlantısı planlanıyor; alt bağlantı ünitesi henüz yok. Uyumlu iletişim ünitesi, üretici sürücüsü/SDK ve eşleşme erişimi bekleniyor. İlk Hugin marka bilgisi, bu model bilgisiyle güncellenmiştir. Bağlı modda para yükleme kapalıdır. Mevcut mobil `mock` ödeme sağlayıcısı POS onayı olarak kullanılmaz; POS simülasyonu gerçek PanCafe bakiyesine ulaşamaz.

Bu sürüm cihazlarla sahada doğrulanmış bir üretim yayını değildir. API'nin mevcut development/staging/production korumaları korunur.

## Geliştirme

Node 22.13+ / tercihen 24:

```sh
cd kiosk
npm ci
npm run dev
```

`npm start` tam ekran; `npm run dev` pencereli. Demo bağımsız çalışır, API gerekmez. NFC testinde kart kimliğini hızlı yazıp Enter'a basılabilir; gerçek okuyucu aynı protokolü göndermelidir. PC/SC veya seri modundaki okuyucu için modele uygun sürücü/adaptör ayrıca gerekir. Onaltılık/ondalık kimlik dönüşümü otomatik yapılmaz: PanCafe'ye kaydedilen okuyucu çıktısıyla aynı kimlik kullanılmalıdır.

## Windows çıktısı

```sh
npm run build:win
```

Çıktı `dist/kiosk.exe`: Windows x64 tek dosya taşınabilir uygulama. Kod imzası henüz yoktur. `npm run pack:win` ise `dist/win-unpacked/kiosk.exe` ve beraberindeki dosyaları üretir; bu exe tek başına taşınamaz, bütün klasör birlikte kopyalanır. GitHub Actions şablonu `build/windows-kiosk.yml.example` içindedir. Depodaki `.github/workflows/kiosk.yml` yoluna kopyalandığında Windows üzerinde tek dosyalık çıktıyı oluşturur. Mevcut GitHub erişim anahtarında `workflow` yetkisi olmadığı için şablon otomatik çalışacak konuma eklenmemiştir. Yerel `npm run build:win` komutu kullanılabilir.

## Yapılandırma

Varsayılan dosya `%APPDATA%/kiosk/kiosk.config.json`. `STECH_KIOSK_CONFIG` ortam değişkeniyle başka bir mutlak dosya yolu seçilebilir. Dosya yoksa açıkça etiketlenen demo açılır. `kiosk.config.example.json` başlangıç örneğidir. Bağlı moddaki hatada demo hesaba otomatik geçiş yapılmaz.

```json
{
  "mode": "connected",
  "station": "S TECH · Merkez",
  "idleSeconds": 90,
  "completionSeconds": 20,
  "apiBaseUrl": "http://127.0.0.1:3001/api/v1",
  "deviceKey": "SUNUCUDAKI_AYNI_UZUN_CIHAZ_ANAHTARI",
  "adminPinHash": "URETILEN_128_KARAKTER_HEX_HASH"
}
```

Yerel sunucu için HTTP localhost, uzaktaki sunucu için HTTPS gerekir. Anahtar/PIN/config dosyaları git'e girmez. Başka bilgisayardaki PanCafe köprüsüne doğrudan erişim verilmez: API köprünün bulunduğu Windows bilgisayarında çalışmalıdır. API'ye kiosk bilgisayarından HTTPS üzerinden erişilir.

Anahtar üretimi: `node scripts/provision.cjs device-key`.

PIN hash üretimi: `node scripts/provision.cjs pin-hash`; 6–16 rakamlık PIN'i stdin'e yazıp girişi bitirin (Unix Ctrl-D; Windows Ctrl-Z ardından Enter). PIN'i komut argümanına koymayın.

API `.env`:

```dotenv
CAFE_ADAPTER=pancafe
PANCAFE_BRIDGE_CONFIG=D:/.../connection.json
KIOSK_DEVICE_KEY=KIOSK_ILE_AYNI_EN_AZ_40_KARAKTERLIK_ANAHTAR
```

Yeni `/card-member` ucu için `scripts/build-pancafe-bridge.ps1` ile Windows köprüsünü yeniden derleyip operatörün başlatması gerekir. PanCafe kart girişi ek kayıt/eşleme dosyası istemez; doğrudan mevcut soyadı alanını kullanır. Otomatik giriş, yeni mobil kimlik/eşleme kaydı oluşturabilir; PanCafe şifresini değiştirmez veya ayrı müşteri bakiyesi oluşturmaz. NFC kart kimliği, üyeyi bulmak için kullanılır; kriptografik kart doğrulaması değildir.

Opsiyonel mock API kart eşlemesi için `KIOSK_CARD_MAP_FILE` mutlak JSON yolu kullanılabilir: `{"cards":[{"cardHash":"SHA256_NORMALIZED_UID","userId":"demo-member"}]}`. Hash `node scripts/provision.cjs card-hash` ile stdin'den üretilir. PanCafe modunda bu dosya gerekmez.

## Ortak bilgisayar davranışı

- Başarılı yüklemeden sonra ATM akışı: **Başka bir işlem yap** ana ekrana döner; **İşlemleri bitir** ek onay sormadan kart bekleme ekranını açar. Seçim yapılmazsa varsayılan 20 saniyede oturum kapanır. `completionSeconds` ile 5–60 saniye ayarlanabilir. Ekrana rastgele dokunmak veya tekrar gelen ödeme onayı bu süreyi uzatmaz. Bu aşamada genel hareketsizlik uyarısı açılmaz.
- Varsayılan 90 saniye hareketsizlik; son 15 saniye uyarı. Yapılandırılabilir sınır 30–120 saniye. En fazla 5 dakika sonra yeniden kart okutulur.
- Oturum anahtarı yalnızca Electron ana sürecinin belleğinde tutulur; sayfaya ve diske verilmez. Kiosk anahtarı renderer'a aktarılmaz.
- Çıkışta önce ekran/veriler temizlenir, sunucu oturumu iptal edilir. Geç gelen önceki müşteri yanıtları gösterilmez. API kiosk anahtarları yenilenemez ve 5 dakikada biter.
- `Ctrl+Alt+Q` yetkili PIN ekranı. Demo PIN `2026`; bağlı modda özel PIN hash zorunlu. Dakikada 5 çıkış denemesi sınırı.
- Tam ekran uygulama düzeyindedir. Windows tuşları/oturum geçişini kilitlemek için işletim sistemi düzeyinde atanmış erişim veya Shell Launcher kurulumu ayrıca gerekir.

## Kontroller

```sh
npm run check
npm test
npm run test:ui
```

UI testi gerçek Electron açar ve geçici verilerle kart girişi, ödeme onay/red, bonus, geçmiş, kampanya, profil, müşteri ayrımı ve dar ekranı kontrol eder. Görseller `docs/screenshots` altına yazılır. Root API testlerinde cihaz anahtarı, kısa oturum, iptal ve PanCafe kart eşleşmesi kontrol edilir. C# köprüsü / gerçek okuyucu / PAX donanımı bu Mac üzerinde çalıştırılarak doğrulanmamıştır.

## PAX 910S / USB bağlantısında tamamlanacak işler

Resmî cihaz kaynağı: https://www.paxtechnology.com/a910s . USB portunun varlığı bir ödeme protokolünü belirlemez. Cihaz üzerinde çalışan banka/ödeme uygulamasına ait Windows ECR/USB sürücüsü, SDK/protokol ve aktivasyon bilgileri sağlanmalıdır. A910S ile mali A910SF aynı entegrasyon varsayımıyla ele alınmaz. İlk araştırılan Hugin PC Link API, bu PAX cihazında doğrulanmadan kullanılmaz. Ayrıntılar `docs/POS_INTEGRATION.md` içinde.

Ödeme bağlandığında tutar ve bonus sunucudan alınmalı, sipariş önce kalıcı kaydedilmeli, terminalin doğrulanmış sonucu tutar/para birimi/işlem referansıyla eşleştirilmeli, yalnızca kesin onaydan sonra mevcut kalıcı PanCafe aktarım kuyruğuna bırakılmalıdır. Timeout ödeme reddi değildir: aynı terminal referansı sorgulanmadan ikinci tahsilat başlatılmamalı. Yeniden başlatma, ağ kesilmesi, mükerrer onay, iade ve mutabakat gerçek cihazla test edilmelidir. Kart/PIN verisi uygulamaya alınmaz.
