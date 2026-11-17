# Mevcut S TECH kiosku güncelleme

Komutları **PanCafe ve S TECH sunucusunun kurulu olduğu bilgisayarda** çalıştır. A ve B ayrıysa bu bilgisayar A’dır. Dosya Gezgini’nde `S-TECH-Baslat.cmd` dosyasının bulunduğu proje klasörünü aç ve klasörü PowerShell terminalinde aç.

Devam eden POS ödemeleri sonuçlandıktan sonra kiosku kapat. Tam ekrandaki kiosk için `Ctrl+Alt+Q` ve mevcut kiosk PIN’i kullan. S TECH Başlatıcıda **8** ile S TECH servislerini durdur. Windows köprüyü kapatmak için izin isterse onayla.

```powershell
git branch --show-current
git status --short
```

İlk komut `main` göstermeli. İkinci komut çıktı verirse önce yerel değişiklikleri incele; temizlemeden veya üzerine yazmadan burada dur.

```powershell
$yedekDal = "backup/kiosk-oncesi-$(Get-Date -Format yyyyMMdd-HHmmss)"
git branch $yedekDal
if ($LASTEXITCODE -ne 0) { throw 'Yedek dal olusmadi.' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git guncellemesi tamamlanmadi.' }
npm.cmd ci --workspace '@stech/api' --include-workspace-root=false
if ($LASTEXITCODE -ne 0) { throw 'API bagimliliklari kurulamadi.' }
npm.cmd run build:api
if ($LASTEXITCODE -ne 0) { throw 'API derlenemedi.' }
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\build-kiosk.ps1
if ($LASTEXITCODE -ne 0) { throw 'Kiosk derlenemedi.' }
```

**PanCafe ve kiosk aynı bilgisayardaysa** `S-TECH-Baslat.cmd` dosyasını aç ve **1** yaz.

**B ayrı kiosk bilgisayarıysa** A’da `S-TECH-Baslat.cmd` dosyasını aç ve **3** yaz.
Kiosk IPv4 sorusunda mevcut adres doğruysa Enter’a bas. Bu seçenek A’daki sunucuyu başlatır ve
`Kurulum-Ciktisi\B-Kiosk.zip` paketini oluşturur. ZIP’i B’ye kopyala ve yeni bir klasöre tamamen çıkart.
B’de yeni klasördeki `B-Kiosk\Kiosk-Baslat.cmd` dosyasını çalıştır. Eski B klasörünü kontrol bitene kadar sakla.

Bu güncelleme mevcut kurulumu kullanır. PanCafe veritabanı, eşleştirme, Wallet ve Ödeal yapılandırması kurulu olduğu bilgisayarda kalır.
Başlatıcıda **5** ile bağlantı durumuna, ardından kiosktan girişe, bilgisayar seçimine,
işlem geçmişine ve ödeme ekranına bak. Ödeme ekranını kontrol etmek için tahsilat başlatmak gerekmez.
