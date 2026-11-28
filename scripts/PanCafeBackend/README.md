# S TECH PanCafe backend

Controller 2.4.1'de kullanılan x86 native köprü çekirdeği bu klasöre kaynak olarak alınmıştır. `PanCafeController.exe` bağımlılığı yoktur. `NativeBridge.cs`, `FbDb.cs`, `FbConnection.cs`, `ControllerDatabase.cs` ve `BuildBackendHook.cjs` sürüme bağlı özel ABI'yi içerir. `LiveBackend.cs`, köprü HTTP akışına dar bir bağlantı arayüzü sağlar.

S TECH ekleri: atomik ödeme makbuzu ve bonus ayrımı, eski UI kayıtlarıyla uyumluluk, bilet satış/tüketim transaction'ı ve `TTicket`/bilet dataset yenilemesi (protokol 5). Üye ve oturum işlemlerinin ana native çağrı sırası korunmuştur. Bilet dataset ofseti `0x5F0`, `TTicketManager` globali `0x0109247C`, `GetTicketByID` `0x009AE324`, `TTicket` yükleme işlevi `0x009AC72C`; bunlar pinlenen exe'nin RTTI ve disassembly verilerinden doğrulanmıştır. Runtime işlev imzaları da kontrol edilir.

`*Tests.cs` dosyaları yalnızca izole test exe'sine derlenir. Fixture adresleri kendi süreç sayfalarına taşınır; gerçek PanCafe adresleri çağrılmaz. Üretim derlemesi test profilini reddeder. Yerel build çıktıları `.data` altındadır; generated DLL/profil kaynak klasörüne gerekmez.

Kullanım ve teknik akış: [pancafe-native-sessions.md](../../docs/pancafe-native-sessions.md).
