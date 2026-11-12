# Kiosk tasarım merkezi

Admin panelinde **Kiosk tasarım merkezi** menüsü kullanılır. Mevcut PanCafe,
ödeme, bonus ve S Coin servisleri korunur.

## Çalışan yönetim alanları

- Marka adı, karşılama sloganı, logo ve amblem.
- Tema renkleri, font seçimi, temel font boyutu, bölüm boşluğu, köşe ve buton yüksekliği.
- Menü etiketleri, ikonları, görünürlük ve sürükle-bırak / yukarı-aşağı sırası.
- Ana ekrandaki hızlı erişim butonlarının yazısı, ikonu, görünürlüğü ve ekran hedefi.
- Ekran ekleme, çoğaltma, arşivleme, silme; hedef ilişkisi kontrolü.
- Ana ekran sistem bölümleri ve kupon görünürlüğü. Sistem bölümleri kendi yerleşim
  grupları içinde sıralanır; ödeme özeti ve güvenlik uyarıları kaldırılamaz.
- Metin, görsel/banner, kart listesi ve ekran aksiyonu bölümleri; sıralama,
  çoğaltma, görünürlük, kolon sayısı, hizalama ve önizleme seçimi.
- Statik metin kataloğu, Türkçe/İngilizce karşılıkları ve arama. Çevrilmeyen
  içerik Türkçeye döner; kullanıcı adları ve tutarlar metin kataloğuna alınmaz.
- PNG/JPEG/WebP medya yükleme, isim, alternatif metin, odak, contain/cover,
  kullanım listesi ve referanslı dosya silme koruması.
- Oturum boşta kalma süresi (30–300 saniye; toplam oturum güvenlik sınırı korunur),
  başlangıç ekranı, dil, slider süresi, otomatik kaydırma, animasyon ve bakım modu.
- Gerçek kiosk renderer'ı ile dikey/yatay taslak önizlemesi; test üyesi kullanır,
  gerçek oturum/ödeme işlemi çalıştırmaz.

## Veri ve yayın

`kiosk_design_state` tek taslağı ve revizyonunu tutar.
`kiosk_design_versions` değiştirilemeyen yayın snapshot'larını, zamanı ve yönetici
adını tutar. Tablolar mevcut `database/schema.ts` idempotent açılış migration'ıyla
otomatik oluşturulur. PostgreSQL ve mevcut yerel PGlite desteklenir.

Taslak kaydı canlı sürümü değiştirmez. Yayınlama tek SQL transaction'ıdır.
İyimser revizyon kontrolü eşzamanlı yönetici değişikliklerini 409 ile durdurur.
Geri alma, eski snapshot'tan **yeni bir yayın** üretir; geçmiş silinmez.
Kaydetme/yayınlama audit kayıtlarına yazılır. Görüntüleyici okuyabilir,
operatör taslak düzenleyebilir, yalnızca kurucu yayınlayıp geri alabilir.

Kiosk `/api/v1/kiosk/design` üzerinden 15 saniyede bir ETag ile yayın kontrolü
yapar. Aktif üyeliğin bitmesine kadar yeni görünüm uygulanmaz. Son geçerli
yapılandırma ve içindeki görseller yerel önbellekte tutulur; üye/token/bakiye
bu önbelleğe yazılmaz. Çevrimdışıyken finansal işlemler onaylanmış sayılmaz.
Bakım modu yeni kiosk girişlerinde sunucu tarafında da uygulanır.

Medya veritabanı snapshot'ında kalıcı tutulur: dosya başına 1 MB, en fazla 40
görsel, toplam yapılandırma 6 MB. İmza ve MIME doğrulanır; SVG/HTML/video kabul
edilmez. Böylece dosya depolama servisi olmadan kırık yayın referansı oluşmaz.

## Dağıtım ve test

API ile `apps/admin` ve `kiosk/ui` birlikte dağıtılmalıdır. Gerekirse
`ADMIN_WEB_DIR` ve `KIOSK_UI_DIR` tam yollarını tanımlayın. Electron paketinde
yeni `managed-design.js` ve güncel gateway/session dosyaları bulunmalıdır;
eski kiosk.exe bu endpoint'i sorgulamaz. `scripts/sync-local-preview.ps1`
yerel API/admin/kiosk önizleme dosyalarını birlikte günceller.

- API: `npm run typecheck`, `npm run build`,
  `node --import tsx --test test/kiosk-management.test.ts test/admin.test.ts test/core.test.ts`
- Kiosk: `npm test`, `node scripts/campaign-sync-smoke.cjs`
- UI: API klasöründe `node --import tsx test/design-preview-server.ts`,
  sonra kiosk klasöründe `node scripts/design-smoke.cjs`.
  Test sunucusu 3009'da bellek veritabanı kullanır; canlı veriye dokunmaz.

## Kapsam sınırları

Bu merkez güvenli, tanımlı kiosk bileşenlerini düzenler; serbest HTML/JS veya
işletim sistemi/donanım komutları çalıştırmaz. Video depolama, özel font yükleme,
çalışma saatlerine bağlı otomatik yayın, kategori/ürün kataloğu ve cihaz filosu
yönetimi bu sürümde yoktur. Finansal kampanya/bonus kuralları mevcut **Kampanya
ve bonus** menüsünde yönetilmeye devam eder; tasarım geri alma işlemi finansal
kuralları veya hesap bakiyelerini geri almaz. Dinamik sunucu hata mesajları ve
oyun kuralları tasarım metin kataloğundan değiştirilemez.
