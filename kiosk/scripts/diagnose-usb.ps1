# Read-only: list connected devices and drivers. Does not send payment commands.
$ErrorActionPreference = 'Stop'
Write-Host 'S TECH - USB / POS baglanti kontrolu'
Write-Host 'Bu arac yalnizca cihaz ve surucu bilgilerini okur.'
Get-CimInstance Win32_SerialPort |
    Select-Object DeviceID, Name, Description |
    Format-Table -AutoSize
Get-PnpDevice -PresentOnly |
    Where-Object { $_.Class -in @('Ports', 'SmartCardReader', 'HIDClass') -or $_.FriendlyName -match 'PAX|HUGIN|A910|NFC|RFID' } |
    Select-Object Status, Class, FriendlyName |
    Format-Table -AutoSize
Write-Host 'POS terminalindeki odeme uygulamasi ve USB ECR surucusunu ayrica kontrol edin.'
