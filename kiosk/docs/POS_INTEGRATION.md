# POS bağlantı durumu

Kullanıcının 29 Ekim 2026 bildirimi: **PAX 910S, USB**. Önceki marka ifadesi Hugin idi. PAX resmî ürün adı A910S; A910SF mali modeliyle karıştırılmamalıdır. Cihazdaki ödeme uygulaması kullanıcı tarafından **İş Bankası** olarak bildirildi. Cihazın şu anda bilgisayarla doğrudan bağlantısı yok; alt bağlantı ünitesi henüz temin edilmemiş. USB planlanan bağlantıdır, kurulmuş ve test edilmiş bir bağlantı değildir. Donanım modelinden USB komut protokolü çıkarılmaz.

## Beklenen bilgiler

- Tam model etiketine uygun, veri iletişimini destekleyen alt bağlantı ünitesi ve USB kablosu. Yalnızca şarj standı yeterli kabul edilmez. A910S/A910SF ayrımı satın almadan önce servis tarafından doğrulanmalı.
- Üreticinin/kuruluşun Windows USB ECR sürücüsü ve SDK/protokol dokümanı.
- Kasa-terminal eşleşme/entegrasyon aktivasyonu ve test erişimi.
- İşlem başlatma, önceki işlemi sorgulama, iptal/iade; kesin onay, red, devam ediyor ve belirsiz sonuç kodları.

Müşterinin banka kartı veya PIN'i kiosk tarafından okunmaz. Tutar terminale gönderilir; işlem terminalde yürür. USB bağlantısının yalnızca şarj/Android veri bağlantısı olması, ödeme API'si olduğu anlamına gelmez.

## Donanım geldiğinde

Yetkili servisten tam modelle uyumlu iletişim ünitesi, Windows USB sürücüsü, kasa entegrasyonu (ECR/GMP3 veya cihazın desteklediği diğer protokol) dokümanı ve gerekiyorsa eşleşme/aktivasyon istenmeli. İş Bankası uygulamasının cihazda ödeme alabilmesi, kasa yazılımıyla entegrasyonun etkin olduğu anlamına gelmez.

Ünite takılınca önce `scripts/diagnose-usb.ps1` ile Windows cihaz/sürücü görünürlüğü okunabilir. Sonra üreticinin test erişimiyle terminal bağlantısı ve ödeme sonucu sorgulama doğrulanmalı. Gerçek POS adaptörü ancak doğrulanan protokole göre yazılacak.

## Uygulanacak akış

1. API üyeyi, kampanyayı ve tutarı doğrular; kalıcı bir POS sipariş numarası oluşturur.
2. Ana süreçteki üretici adaptörü aynı referansla terminale tutarı gönderir. UI terminal komutuna veya anahtarına erişmez.
3. İşlem sonucu, sipariş referansı, para birimi ve tahsil edilen tutar doğrulanır. Bilinmeyen veya timeout sonucu red/başarı sayılmaz.
4. Kesin onay kalıcı kaydedilince PanCafe aktarım kuyruğu oluşturulur. Kafe aktarımının başarısız olması ikinci tahsilata yol açmaz.
5. Mevcut PanCafe makbuz/operation ID mekanizması ile tutar ve bonus bir kez eklenir. Kaynak bakiyesi doğrulanınca müşteri başarı ekranı görür.
6. Yeniden başlatma, bağlantı kopması veya müşteri oturumu kapanmasında iş sunucuda devam eder; başka müşterinin ekranına ödeme ayrıntısı dönmez. Belirsiz tahsilatlar aynı referansla sorgulanır; tekrar ödeme başlatılmaz.

## Mevcut sınır

Kiosk bağlı modda tüm `quote/create/settle/payment` IPC işlemlerini reddeder. Demo onayı yalnızca yerel deneme dosyasını günceller. Mevcut mobil simülasyon uçları gerçek POS doğrulamasına dönüştürülmemiştir. Üretici protokolü sağlanmadan uydurma seri-port komutları veya sahte POS başarıları kullanılmaz.

## Kaynaklar

- PAX resmî model: https://www.paxtechnology.com/a910s
- PAX Türkiye donanım belgesi: https://www.paxturkiye.com/datasheets/PAX_A910S_DATASHEET_TR.pdf
- İş Bankası desteklenen ÖKC listesi: https://www.isbank.com.tr/is-ticari/yazarkasa-pos-yeni-nesil-okc
- A910SF iletişim ünitesi (A910S için uyumluluk teyidi değildir): https://ikasa.com.tr/iletisim-ve-sarj-unitesi/
- İlk marka için incelenen Hugin portalı: https://developer.hugin.com.tr/ (PAX USB desteği doğrulanmadı)

Bu kaynaklar gerçek cihaza erişim ve model/ödeme uygulamasına ait SDK yerine geçmez.
