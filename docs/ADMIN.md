# S TECH Yönetim

Panel: http://localhost:3001/admin/

## Çalışan özellikler
- Ayrı yönetici hesabı; kurucu, operatör ve izleyici yetkileri. Şifreler scrypt ile türetilir; oturum anahtarlarının yalnızca hash'i saklanır. Üye oturumları yönetici API'lerine giremez.
- Tek kullanımlık, yalnızca yerel bağlantıdan erişilen kurulum; ADMIN_SETUP_TOKEN gizli ortam ayarı gerekir. İlk kurulumdan sonra bu yol yeniden hesap oluşturamaz.
- PanCafe üye arama, sayfalama, bakiye/bonus ve son 100 kaynak hareketini inceleme.
- Para ekleme/çıkarma, toplam bakiyeyi belirleme ve bonus ekleme/çıkarma. Bonus toplam bakiyenin içindedir. Normal para çıkarma bonusu yanlışlıkla tüketemez.
- İşlem nedeni, ayrı işlem kimliği ve beklenen kaynak bakiye zorunludur. PanCafe değişmişse işlem reddedilir. Aynı işlem tekrar gönderilirse kaynak makbuzu kullanılır; ikinci kez uygulanmaz.
- Native Firebird işlemi: bakiye + bonus + makbuz + MEMBERSHISTORY aynı transaction içinde. Mobil geçmişte yönetici düzenlemesi olarak görünür.
- Kampanya ekleme/güncelleme, yayına alma/durdurma; minimum tutar, yüzde, bonus üst sınırı, tarih ve koşullar. Eşzamanlı güncellemeler revision kontrolüyle korunur. Başlamış ödeme kendi kayıtlı bonusunu korur.
- Ödeme filtreleme, bekleyen aktarımı aynı ödeme kimliğiyle yeniden deneme, bakiye değişikliği ve audit kayıtları.
- Mobil ana sayfada tarihli duyuru yayını; genel destek metni; yeni yüklemeleri geçici durdurma. Alınmış ödemelerin aktarımı sürer.
- Yönetici hesabı ekleme/kapatma; kendi şifresini değiştirme ve eski oturumları iptal etme.

## Harici bağlantı bekleyen alanlar
- Bildirim planları: metin, günlük Türkiye saati (varsayılan 16.00), izinli kitle taslağı. Push gönderimi YOK; taslak olarak gösterilir.
- Üyelik seviyeleri: ad/avantaj taslağı; PanCafe fiyatı veya üye seviyesi uygulanmaz.
- İade talepleri: tamamlanmış ödeme için inceleme kaydı; gerçek banka iadesi ve otomatik bakiye geri alma YOK.
- Gerçek ödeme, üretim ortamı ve internetten yayın önceki geliştirme kilitleriyle kapalıdır.

## Yerel kurulum
1. API ortamında ADMIN_WEB_DIR statik apps/admin klasörüne, PANCAFE_BRIDGE_CONFIG güncel bağlantı aracının connection.json dosyasına işaret etmeli.
2. scripts/build-pancafe-bridge.ps1 ile güncel aracı derle. Loopback portları 3002/3003/3004 desteklenir. Yönetici paneli için yeni sürüm gerekir.
3. Bağlantı penceresinde “Yönetim panelinin bakiye düzenlemesine izin ver” seçeneği kapalı başlar. Yetkili işletmeci açınca izin kaydedilir. Pencere kapanırsa kaynak erişimi durur.
4. İlk yönetici hesabını yerel kurulum ekranında oluştur. Bu bilgisayardaki ilk giriş bilgileri repo dışında %APPDATA%/stech-admin/Giris Bilgileri.txt konumundadır.
5. scripts/build-admin-desktop.ps1 yönetim EXE'sini paketler. Bu yerel sürüm mevcut backend kurulumunu kullanır; kapalıysa başlatır. PanCafe bağlantı aracını ayrıca işletmeci açar.

## Doğrulama ve sınırlar
Backend testleri yönetici/üye oturum ayrımı, salt yetki, kampanya güncellemesi, ödeme teklifine yansıma, durdurulan yeni yükleme sırasında eski ödemenin tamamlanması ve belirsiz native cevaptan sonra tek makbuzla toparlanmayı kapsar.
TestPanCafeAdminWriter gerçek Firebird dosyasının kopyasında para/bonus ekleme/çıkarma, negatif bakiye, yanlış üyelik, stale balance, duplicate ve atomik rollback kontrol eder. Testler canlı üyelerin bakiyesini değiştirmez.
İlk sürüm raporları mobil ödemeleri kapsar; toplam işletme cirosu olarak kullanılmaz. Audit/ödeme listeleri tarih imleciyle sayfalanır; aynı tarihli yoğun kayıtlar için ileride birleşik tarih+kimlik imleci gerekir.
