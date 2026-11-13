# S TECH: tum degisiklikleri commit edip GitHub'a (origin/main) gonderir. (ASCII only)
$ErrorActionPreference = 'Stop'
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say $text 'Red'; Read-Host 'Kapatmak icin Enter'; exit 1 }

$repo = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repo
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git bulunamadi. Git for Windows kurulu olmali.' }

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Say "Depo: $repo  Dal: $branch"

# 1) Gonderilecekleri goster
git add -A
$files = @(git diff --cached --name-only)
if ($files.Count -eq 0) { Say 'Commit edilecek degisiklik yok.' 'Yellow' }
else {
  Say ("{0} dosya gonderilecek:" -f $files.Count) 'Cyan'
  git status --short
  # Gizli bilgi icerebilecek dosyalar .gitignore ile disarida kalmali
  $risky = $files | Where-Object { $_ -match '(^|/)\.env($|\.)' -and $_ -notmatch '\.env\.example$' -or $_ -match 'connection\.json$|kiosk\.config\.json$|firebase\.json$|\.(pem|key)$' }
  if ($risky) { git reset -q; Fail ("Gizli bilgi icerebilecek dosyalar var, gonderim durduruldu:`n" + ($risky -join "`n")) }
  $answer = Read-Host 'Bunlari commit edip GitHub''a gondermek icin E, vazgecmek icin Enter'
  if ($answer -notmatch '^[eE]') { git reset -q; Say 'Vazgecildi; hicbir sey degismedi.' 'Yellow'; Read-Host 'Kapatmak icin Enter'; exit 0 }
  $msg = Join-Path $env:TEMP 'stech-commit-msg.txt'
  @'
Kiosk: bilgisayar turleri ve izometrik salon planlari, PanCafe arka plan oturum acma

- Bilgisayarlar ekrani: tur secimi (bos/toplam), Beginner, Player, Gamer, Master ve
  Master 2 icin izometrik plan, sari secim cercevesi ve onay ile PanCafe oturumu
- Kiosk varsayilan olarak 1080x1920 pencerede acilir; tam ekran icin --fullscreen
  veya kiosk.config.json "fullscreen": true
- PanCafe koprusu oturum acmayi pencere mesajlariyla arka planda yapar; gercek
  fare/klavye otomatik yedek yol olarak kalir, Genel sekmesi hatasi netlesti
- Kiosk-Derle.cmd, Kiosk-Baslat.cmd ve Kopru-Derle.cmd yardimci betikleri
- Belgeler ve testler guncellendi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014tKygjuR6SzoRD2HdKkQfi
'@ | Set-Content -LiteralPath $msg -Encoding UTF8
  git commit -q -F $msg
  if ($LASTEXITCODE -ne 0) { Fail 'Commit olusturulamadi (git kullanici adi/e-posta ayarli mi?).' }
  Say 'Commit olusturuldu.' 'Green'
}

# 2) Uzak depodaki yenilikleri al, sonra gonder
git pull --rebase origin $branch
if ($LASTEXITCODE -ne 0) { Fail 'GitHub''daki degisikliklerle cakisma var. git status ile kontrol et; bu dosyayi Claude''a bildir.' }
git push origin $branch
if ($LASTEXITCODE -ne 0) { Fail 'Gonderim basarisiz (GitHub girisi gerekebilir).' }
Say "GitHub'a gonderildi: $(git rev-parse --short HEAD)" 'Green'
Read-Host 'Kapatmak icin Enter'
