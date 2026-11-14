# S TECH nasıl açılır?

Projenin ana klasöründeki **S-TECH-Baslat.cmd** dosyasını çift tıkla. Bu bilgisayarda masaüstündeki **S TECH Baslat** kısayolu da aynı menüyü açar.

## PanCafe ve kiosk aynı bilgisayarda

1. **S-TECH-Baslat.cmd** dosyasını aç ve **1** yaz.
2. İlk kurulumda istenirse Firebase hizmet hesabı JSON dosyasını seç. Aktif bir PanCafe üyesinin numarasını ve aynı hesabın kullanıcı adını gir. Kiosk çıkışı için 6–16 rakamlık bir PIN belirle.
3. Windows izin penceresi açılırsa onayla. PanCafe, bağlantı aracı, backend ve kiosk bu bilgisayarda çalışır. Ödeal ayarları bu bilgisayarda varsa ngrok da açılır.

Bilgisayar yeniden açıldığında yine **1** seç. Kiosk pencere modunda açılır. Bu kurulumda IP adresi girilmez.

## A bilgisayarı PanCafe, B bilgisayarı kiosk

**İlk kurulum**

1. A ve B’yi aynı yerel ağa bağla. **B’de** Komut İstemi’ne `ipconfig` yaz ve bağlı Wi-Fi veya Ethernet bağlantısının **IPv4 Adresi** satırını bul.
2. **A’da** projeyi aç. **S-TECH-Baslat.cmd → 3** seç. Sorduğunda B’nin IPv4 adresini gir. İlk kurulumda Firebase JSON, PanCafe üye numarası, kullanıcı adı ve kiosk PIN’i de istenir. Windows izin penceresi açılırsa onayla.
3. A’daki proje klasöründen **Kurulum-Ciktisi\B-Kiosk.zip** dosyasını B’ye kopyala. ZIP’in tamamını çıkart. B’de açacağın tek dosya **B-Kiosk\Kiosk-Baslat.cmd**. Kiosk tam ekran açılır.

**Günlük kullanım**

- **A’da** önce **S-TECH-Baslat.cmd → 2** ile PanCafe sunucusunu aç. A, kiosk kullanıldığı sürece açık kalmalı.
- **B’de** çıkarttığın klasördeki **Kiosk-Baslat.cmd** dosyasını aç. B’ye PanCafe, backend veya Node.js kurulması gerekmez.
- A’nın veya B’nin IP adresi değişirse ya da B’ye güncel kiosk sürümü gönderilecekse A’da **3** seçeneğiyle paketi yeniden oluştur. B’de eski kiosku `Ctrl+Alt+Q` ve PIN ile kapatıp yeni paketi kendi klasörüne çıkart.
- PanCafe/Ödeal sunucusunu başka bir fiziksel A bilgisayarına taşırsan Ödeal ve ngrok ayarlarını da yeni A’da kur. B kiosk paketi yalnızca A’ya bağlanmak için gereken bilgileri taşır.

## Yönetim ve dosyalar

İlk kurulumda **kiosktan oturum açma** sorusuna **E** verirsen desteklenen PanCafe sanal masalarında bu özellik etkinleşir. Mevcut kurulumlarda ayar `Bridge\connection.json` içindeki `allowVirtualSessionStart` değeridir. Değişiklikten sonra köprü ve backend yeniden başlatılır.

- PanCafe bilgisayarında sunucu çalışırken **4** yönetim panelini tarayıcıda açar. **5** backend, Firebase, kiosk ve tünel durumunu gösterir.
- Başlatıcı yalnızca `kiosk\dist\current` içindeki derlemeyi kullanır. Bu klasör ilk çalıştırmada oluşturulur. Kiosk kaynak kodu değiştiğinde açık kiosku kapatıp **scripts\Kiosk-Derle.cmd** çalıştır.
- Kurulum, derleme ve bakım araçları `scripts` klasöründedir. Eski A/B kurucuları önceki GitHub paketleriyle uyumluluk için burada durur. Günlük kullanımda üstte anlatılan dosyaları aç.
- PanCafe veritabanı kendi PanCafe klasöründe, S TECH sunucu verileri ve yerel ayarlar `%LOCALAPPDATA%\STech-Kiosk-Sunucu` içinde kalır. Ödeal ayarları `%LOCALAPPDATA%\STech-OdealTunnel` içindedir. ZIP dosyası kiosk cihaz anahtarını içerir. Yalnızca B’ye kopyala.
