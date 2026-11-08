# Üye bilgileri ve değişiklik kayıtları

## Kaynaklar
- `member.memberNumber`: PanCafe `MEMBERS.ID`. Mobil uygulama UUID'si veya kullanıcı adı üye numarası olarak kullanılmaz. Salt okunur; istek gövdesinden değiştirilemez.
- Ad, soyad, cep telefonu, adres ve mevcut üyelik şifresi: PanCafe. Düzenlemeler mevcut `ID` + `USERNAME` eşleştirmesiyle aynı üye kaydına uygulanır. Bakiye, bonus ve üye numarası güncelleme SQL'ine dahil değildir.
- Bu PanCafe sürümünde T.C. kimlik numarası alanı yoktur. Uygulamanın ek profil alanıdır; backend'de AES-256-GCM ile şifrelenmiş profil değişiklik kaydında tutulur. T.C. numarası kontrolü biçim ve matematiksel sağlama kontrolüdür, resmi kimlik doğrulaması değildir.

## Kullanıcı akışı
- Yeni kayıtta ad/soyad ayrı girilir ve geçerli Türkiye cep telefonu zorunludur. Numaralar backend'de `+905xxxxxxxxx` biçimine getirilir. Telefon doğrulanmış/OTP onaylı olarak işaretlenmez.
- Profil → “Bilgilerimi ve şifremi düzenle” ekranında ad, soyad, telefon, isteğe bağlı T.C. numarası ve adres değiştirilebilir.
- Her kayıtta mevcut şifre veya hesaba bağlı üyelik kartı zorunludur; ikisi aynı istekte birlikte kabul edilmez. Her başarılı kayıttan sonra doğrulama alanları temizlenir; yeni değişiklik yeni doğrulama ister. Yeni şifre alanları boş bırakılırsa mevcut şifre korunur; doldurulursa 8–32 karakter sınırı uygulanır.
- Kart seçeneği USB/klavye modunda okuyucunun UID + Enter göndermesi içindir. Telefon NFC donanımıyla otomatik tarama entegrasyonu değildir. Kartın tek bir aktif üyeyle eşleşmesi ve bu üyenin giriş yapılan hesap olması kaynakta doğrulanır; belirsiz/başka hesaba ait kart reddedilir. Kart UID'si genel audit kayıtlarına yazılmaz; yalnızca doğrulama yöntemi kaydedilir.
- Şifre değişince tüm mobil/kiosk erişim ve yenileme oturumları iptal edilir; kullanıcı yeni şifreyle yeniden giriş yapar. PanCafe'nin kendi üyelik şifresi güncellenir; backend ayrı bir şifre kopyası tutmaz.

## Güvenlik ve kayıt
- `GET /api/v1/me/profile`, `PUT /api/v1/me/profile`, `GET /api/v1/me/profile/history` sadece kimliği doğrulanmış hesabı kullanır. Başka kullanıcı/üye no istek gövdesinde kabul edilmez.
- `PROFILE_ENCRYPTION_KEY`: 32 rastgele byte'ın 64 hex karakterli gösterimi. Sunucunun gizli ortam ayarında tutulmalı ve veritabanı yedeğinden ayrı korunmalıdır. Anahtar yoksa profil okuma/yazma kapalıdır. Bu anahtarı değiştirmek önceki şifreli kayıtlar için anahtar geçişi gerektirir.
- `member_profile_changes`: işlem kimliği, üye, durum, değişen alanlar, zaman, eski/yeni profilin şifreli halleri. Mevcut/yeni şifre bu anlık görüntülere ASLA dahil edilmez. İstek bütünlüğü anahtarlı HMAC ile denetlenir.
- `audit_logs`: `member.profile.changed`, kullanıcı kimliği, değişen alanların adları, profil işlem referansı ve şifre değişti bilgisi. Şifre, tam T.C. numarası ve adres genel işlem günlüğüne yazılmaz.
- Yeni istek `pending` olarak dayanıklı biçimde kaydedilir. PanCafe sonucu doğrulanınca `completed` ve audit kaydı birlikte yazılır. Bağlantı belirsizliğinde aynı işlem kimliği/istek tekrar kullanılabilir; farklı içerikle tekrar kullanım reddedilir.
- Kaynak profil revizyonu eskiyse veya mevcut şifre yanlışsa güncelleme reddedilir. PanCafe güncellemesi ve `STECH_PROFILE_OPS` makbuzu aynı Firebird transaction'ındadır.
- Bu kurulumda NFC UID'si eski `LASTNAME` alanında sayısal/hex değer olarak tutulabilir. Soyadı düzenlenirken UID aynı transaction içinde `STECH_MEMBER_CARDS` eşleştirmesine aktarılır. Kart sorgusu hem eski hem yeni eşleştirmeyi kontrol eder; birden çok üyeyle eşleşme reddedilir.

## Testler
- Backend: telefon/kimlik sağlama, şifreli kayıtlar, çok parçalı ad, kaybolan kaynak yanıtından sonra idempotent tamamlama, kullanıcı ayrımı, üye numarası manipülasyonunun reddi ve şifre sonrası oturum iptali.
- `scripts/TestPanCafeProfileWriter.cs`: izole Firebird kopyasında ad/soyad/telefon/adres/şifre, gerçek üye numarası, NFC koruması, yanlış şifre, eski revizyon, tekrarlı şifre değiştirme ve rollback. Canlı üyeler test için değiştirilmez.
- `scripts/profile-ui-smoke.cjs`: geçici backend ile kayıt, profil formu kaydı, 390px düzeni ve şifre değişince giriş ekranına dönüş. `STECH_TEST_TOOLS` ile Playwright'ın yüklü olduğu araç klasörü seçilebilir.
