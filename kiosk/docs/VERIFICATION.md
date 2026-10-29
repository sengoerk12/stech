# Doğrulama — 29 Ekim 2026

Bu çalışma macOS / Apple Silicon ortamında yapıldı.

- API: 40 test geçti. Kiosk cihaz anahtarı, kart eşleştirme, PanCafe soyadı lookup adaptörü, beş dakikalık yenilenemeyen oturum ve çıkış iptali dahil.
- Kiosk: 16 test geçti. İki müşteri ayrımı, hareketsizlik/azami süre, geç gelen yanıt, tekrar onayda tek bakiye artışı, red, disk yazma hatası, kalıcı demo verisi ve gerçek modda simülasyon engeli dahil.
- Gerçek Electron penceresinde otomatik UI akışı geçti: klavye protokolüyle NFC girişi, 200 TL + 20 TL bonus, red, geçmiş, kampanya koşulları, profil, çıkış/başka müşteri ve 1024px yatay taşma kontrolü. Başarılı yükleme sonrası başka işlem seçimi, doğrudan bitirme ve 20 saniye seçim yapılmadığında otomatik kart bekleme ekranına dönüş gerçek Electron penceresinde doğrulandı; rastgele dokunmanın süreyi uzatmadığı kontrol edildi. Ekran görüntüleri `screenshots/` içinde.
- API ve mobil TypeScript kontrolleri, API derlemesi ve mevcut mobil lint geçti.
- Kiosk JavaScript sözdizimi ve `git diff --check` geçti.
- Windows x64 uygulama klasörü çapraz derlendi. Tek dosya taşınabilir EXE için NSIS 1.2.1 araç seti kullanıldı; eski varsayılan araç seti Apple Silicon üzerinde çalışmadığı için proje ayarında yeni araç seti seçildi.

## Sınırlar

- Windows işletim sisteminde EXE başlatılarak test edilmedi.
- Fiziksel NFC cihazı bu bilgisayara bağlı değildi. HID/klavye + Enter protokolü yazılımla sınandı; gerçek okuyucunun modu sahada doğrulanmalı.
- Güncellenen C# PanCafe köprüsü bu Mac'te derlenmedi veya canlı Firebird üzerinde denenmedi. TypeScript adaptör testinde aynı sözleşme taklit edildi. Windows kurulumunda köprü yeniden derlenmeli.
- PAX 910S üzerindeki uygulama İş Bankası olarak bildirildi. USB için gereken alt bağlantı ünitesi henüz yok; gerçek ödeme protokolü/sürücü/SDK ve eşleşme erişimi bekleniyor. Gerçek POS bağlantısı, tahsilat, iade ve POS sonrası PanCafe aktarımı henüz uçtan uca uygulanmış değildir. Bağlı kiosk modunda tahsilat kapalı.
- Uygulama ve paket henüz kod imzalı değil; Windows düzeyinde kiosk kilitleme kurulumdan ayrı bir iştir.
