# S TECH mobile

S TECH marka kimliğine uygun iOS/Android uygulaması ve NestJS geliştirme API'si.

## Çalıştırma
Node.js 22.13+ kullanın.

```sh
npm install
npm run dev:api
# Ayrı terminal:
npm run web
# Telefon için:
npm run dev:mobile
```

Mock modunda demo hesabı: `demo` / `StechDemo2026!`. Bu bilgisayarın yerel API ayarı PanCafe moduna alındı; PanCafe modunda demo bilgileri kullanılmaz. Masaüstündeki **S TECH - PanCafe Baglantisi** aracı operatör tarafından açılıp Windows yönetici onayı verildikten sonra PanCafe kullanıcı adı ve şifresiyle giriş yapılır. Ayrıntılar: [PanCafe test kurulumu](docs/PANCAFE_SETUP.md).

Telefon bağlantısı için `apps/mobile/.env.example` dosyasını `.env` olarak kopyalayın; `EXPO_PUBLIC_API_BASE_URL` değerinde bilgisayarın yerel ağ IP adresini kullanın. Android emülatöründe varsayılan adres `10.0.2.2:3001` olur. Gerçek cihaz için Expo Development Build kullanın. EAS giriş, proje kaydı ve imzalama bilgileri bu depoya dahil değildir.

## Mevcut özellikler
- Markaya uygun ana sayfa, giriş, bakiye yükleme, kampanya detayı, filtreli geçmiş ve profil.
- API üzerinden tutar/bonus hesaplama ve ödeme oluşturma.
- Başarılı/reddedilen test ödeme akışı; bakiye ve işlemler API sonucuyla güncellenir.
- Tekrar eden bildirim ve işlem anahtarlarına karşı koruma.
- Oturum yenileme, token rotation/revocation; native secure storage.
- Kalıcı ödeme, bakiye, işlem geçmişi, oturum ve bildirim tercihleri.
- Yarım kalan aktarımlar için kalıcı kuyruk, yeniden deneme ve ana sayfadan işleme geri dönüş.

## Bilinçli olarak bağlı olmayanlar
Gerçek internet kafe sistemi `RealCafeSystemAdapter` içinde boş bırakılmıştır. Gerçek ödeme sağlayıcısı, kart formu ve push gönderimi henüz bağlı değildir. Demo API varsayılan olarak yerel PGlite/PostgreSQL veritabanına yazar; yeniden başlatmada kayıtlar korunur. `DATA_DIR` veri dizinini belirler. `DATABASE_URL` tanımlanırsa ayrı PostgreSQL sunucusu kullanılır. PGlite veri dizinini aynı anda yalnızca bir API süreci açmalıdır. Çalışan şema `database/001_runtime.sql` içindedir.

Bu bilgisayarda C: disk alanı nedeniyle kurulu bağımlılıklar D: üzerinde tutulur. Kaynaklar bu klasördedir; yerel önizleme `D:\stech-build-cache\project` kopyasından çalışır. Kaynakları güncelledikten sonra `./scripts/sync-local-preview.ps1` çalıştırın ve geliştirme komutlarını bu D: klasöründe kullanın. Expo varlık dışa aktarımı, farklı sürücülere yayılan junction kurulumunda hata verdiğinden bu bilgisayarda derlemeyi D: kopyasından yapın. Başka bir bilgisayarda normal `npm install` yeterlidir. Makineye özgü ayrıntılar `docs/VERIFICATION.md` içindedir.

**Bu sürüm mağaza yayınına hazır değildir.** Production/staging API ve production mobil derlemesi bilerek engellenir. Gerçek entegrasyonlar ve yayın kontrolleri tamamlanmadan gerçek ödeme alınamaz. Ayrıntılar: `docs/ARCHITECTURE.md`.

## Doğrulama
```sh
npm run typecheck
npm test
npm run build:api
npm run lint -w @stech/mobile
```

26 kritik test; bonus sınırları, tekrar webhook, tutar manipülasyonu, başarısız ödeme, uzaktan aktarım sonrası timeout, refresh replay, HTTP akışı, SQL rollback, veritabanı yeniden başlatma, kalıcı kuyruk, işleyici lease kurtarma, yeni hesapların veri ayrımı, 50 TL minimum / 200 TL bonus eşiği ve PanCafe kimlik/parola aktarımını kapsar.
## Kayıt ol

Giriş ekranındaki “Kayıt ol” bağlantısı kayıt formunu açar. Yeni hesaplar geliştirme adaptöründe kalıcı olarak saklanır; bakiye 0 TL, işlem geçmişi boştur. Telefon ve e-posta isteğe bağlıdır; girilmeyen alanlara örnek bilgi eklenmez. İletişim bilgileri henüz SMS/e-posta ile doğrulanmaz. Kayıt sonrası otomatik giriş yapılır; oturum cihazda kalıcı olarak hatırlanmaz. Gerçek kafe sisteminde hesap açma entegrasyonu sonraya bırakılmıştır. Ek veritabanı şeması: `database/002_registration.sql`.


## Windows müşteri kiosku

Ortak bilgisayarda tam ekran çalışan sürüm `kiosk/` klasöründedir. Ana ekran, NFC kart girişi, bakiye yükleme, kampanyalar, işlem geçmişi ve profil içerir. PanCafe kart kimlikleri mevcut `MEMBERS.LASTNAME` alanından doğrulanır. PAX 910S / İş Bankası USB ödeme entegrasyonu için alt bağlantı ünitesi ve üretici sürücüsü/SDK'sı bekleniyor; gerçek POS tahsilatı henüz etkin değildir. Geliştirme ve kurulum: [Kiosk README](kiosk/README.md).
