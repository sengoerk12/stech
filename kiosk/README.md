# S TECH Kiosk

Günlük kullanım için proje kökündeki **S-TECH-Baslat.cmd** dosyasını aç. [Aynı bilgisayar ve iki bilgisayar kurulumu](../docs/CALISTIRMA.md).

Windows müşteri noktası. `kiosk.exe` açılınca tam ekran başlar. NFC kart girişi, ana ekran, bakiye yükleme, kampanya koşulları, sayfalı işlem/PC oturum geçmişi ve profil ekranları içerir. Mobil uygulamanın koyu tema, turuncu/mavi vurgu ve marka logosu korunmuştur. Ana hedef 1080×1920 dikey dokunmatik ekrandır; 720×1280 dikey ve önceki 1024×768 / 1440×900 yatay yerleşimler de desteklenir.

## Dikey ekran

Dikey yerleşimde menü alt kenardadır; ana bakiye ve kampanya kartları tek sütunda görünür. 1080×1920'de tuş takımı, yükleme özeti ve ödeme düğmesi kaydırma gerektirmeden görünür. Ödeme sonrası devam/bitir seçenekleri alt menünün üzerinde kalır. İçeriği uzun işlem ve kampanya listeleri kendi alanlarında kaydırılabilir.

Windows ekran yönü dikey ve çözünürlüğü 1080×1920 olduğunda uygulama bu alanı tam ekran kullanır. Uygulama Windows ekran ayarlarını değiştirmez. Yatay bilgisayarda tasarımı incelemek için `kiosk.exe --portrait-preview` veya `npm run preview:portrait` kullanılabilir: 1080×1920 içerik, monitöre sığan ölçekli bir pencereye yerleşir.

`npm run test:portrait` gerçek kiosk oturum/deneme ödeme koduyla tarayıcıda 1080×1920 ekranlarını, alt menü erişimini, ödeme düğmesinin görünürlüğünü ve küçük/yatay ekranlara uyumu doğrular. Testler ayrı geçici deneme verisi kullanır. Ekran görüntüleri `docs/screenshots/portrait/` altında üretilir.

## Şu an ne çalışır?

- **Demo:** İki ayrı müşteri, kalıcı deneme bakiyeleri, POS onay/red senaryoları, bonus, tekrar onay koruması ve yarım kalan yüklemeye dönüş. Gerçek tahsilat / PanCafe yazımı yapılmaz. Kartlar `DEMO0001`, `DEMO0002`; ekrandaki demo butonları da aynı akışı açar.
- **PanCafe bağlantısı:** USB klavye modundaki okuyucu kimliği ve Enter gönderir. Backend cihaz anahtarını doğrular; Windows köprüsü kimliği `MEMBERS.LASTNAME` (soyadı) alanında arar. Tam bir eşleşme, aktif üyelik ve kaynak kimlik doğrulaması gerekir. Başta sıfırlar korunur. Birden fazla eşleşme veya bağlantı hatasında giriş verilmez. Bakiye, hareketler ve tamamlanmış PC oturumları mevcut API'den okunur. Soyadı sayısal/hex kart kimliği ise müşteri adına eklenmez.
- **PAX A910S ödemeleri Ödeal D2D üzerinden çalışır.** Sunucu ayarları ve Ödeal bildirim adresleri için [POS entegrasyonuna](docs/POS_INTEGRATION.md) bak.

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

Varsayılan dosya `%APPDATA%\@stech\kiosk\kiosk.config.json`. `STECH_KIOSK_CONFIG` ortam değişkeniyle başka bir mutlak dosya yolu seçilebilir. Dosya yoksa açıkça etiketlenen demo açılır. `kiosk.config.example.json` başlangıç örneğidir. Bağlı moddaki hatada demo hesaba otomatik geçiş yapılmaz.

```json
{
  "mode": "connected",
  "station": "S TECH · Merkez",
  "idleSeconds": 90,
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

- Başarılı yüklemeden sonra **Başka bir işlem yap** ana ekrana döner. **İşlemleri bitir** kart bekleme ekranını açar. Hareketsizlik uyarısı ödeme sonucu ekranında da çalışır.
- Varsayılan 90 saniyelik hareketsizlik süresinin son 15 saniyesinde **Hâlâ burada mısın?** uyarısı açılır. **Buradayım, devam et** süreyi yeniler. Uyarı yanıtsız kalırsa oturum kapanır.
- Oturum anahtarı yalnızca Electron ana sürecinin belleğinde tutulur; sayfaya ve diske verilmez. Kiosk anahtarı renderer'a aktarılmaz.
- Çıkışta ekran ve veriler temizlenir, ardından sunucu oturumu iptal edilir. Geç gelen önceki müşteri yanıtları gösterilmez. Müşteri etkinliği sunucudaki kiosk oturumunu yeniler.
- `Ctrl+Alt+Q` yetkili PIN ekranı. Demo PIN `2026`; bağlı modda özel PIN hash zorunlu. Dakikada 5 çıkış denemesi sınırı.
- Tam ekran uygulama düzeyindedir. Windows tuşları/oturum geçişini kilitlemek için işletim sistemi düzeyinde atanmış erişim veya Shell Launcher kurulumu ayrıca gerekir.

## Bilgisayarlar ekranı

Müşteri önce bilgisayar türünü seçer; her tür kartında boş / toplam sayısı görünür. Tür ekranında boş bilgisayarlar yeşil, dolular kırmızı gösterilir. Yeşil bir bilgisayara dokununca seçim sarı çerçeveyle işaretlenir; **Onayla ve oturumu başlat** ile mevcut PanCafe oturum açma işlemi çalışır. Seçilen bilgisayar bu sırada dolarsa seçim kaldırılır.

Türler ve salon planı `ui/computer-zones.js` içindedir. Tür, PanCafe terminal adından bulunur: adın içinde `Beginner`, `Player`, `Gamer`, `Master` veya `Master 2` geçmeli ve ad sıra numarasıyla bitmelidir (ör. `Beginner 5`, `Player Zone 3`, `Master 2 - 4`). Eşleşmeyen terminaller **Diğer bilgisayarlar** altında listelenir. Beş türün de izometrik planı kat planına göre tanımlıdır; planı olmayan bir tür renkli düğme listesi gösterir. Yerleşim değişirse ilgili `layout` güncellenir.

## Kontroller

```sh
npm run check
npm test
npm run test:ui
```

UI testi gerçek Electron açar ve geçici verilerle kart girişi, ödeme onay/red, bonus, geçmiş, kampanya, profil, müşteri ayrımı ve dar ekranı kontrol eder. Görseller `docs/screenshots` altına yazılır. Root API testlerinde cihaz anahtarı, kısa oturum, iptal ve PanCafe kart eşleşmesi kontrol edilir. C# köprüsü / gerçek okuyucu / PAX donanımı bu Mac üzerinde çalıştırılarak doğrulanmamıştır.

## Ödeal POS

Kurulum ve test adımları [POS entegrasyonu](docs/POS_INTEGRATION.md) belgesinde.
