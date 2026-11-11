using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// Starts virtual member sessions through the operator's PanCafe UI, not by
// editing TERMINALS. Only the verified Turkish v3.3.2 layout is supported.
public static class PanCafeNativeSessions {
    public sealed class Receipt {
        public string OperationId, Username, TerminalName, BeforeDate, BeforeTime, CreatedAtUtc;
        public int MemberId, TerminalId, LogLength;
        public string Status = "pending", Message = "";
    }

    public static List<Dictionary<string,string>> Start(string database, string client,
        string folder, int terminalId, int memberId, string username, string operationId) {
        Guid operation;
        if (terminalId < 1 || memberId < 1 || !Guid.TryParse(operationId, out operation) ||
            !Regex.IsMatch(username ?? "", @"\A[a-zA-Z0-9_.]{1,32}\z"))
            throw new ArgumentException("Invalid session request");

        using (var mutex = new Mutex(false, "Local\\STech-PanCafe-NativeSessions")) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return Result("busy", "Başka bir bilgisayar açma işlemi sürüyor.");
            try {
                string directory = Path.Combine(folder, "session-operations");
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, operation.ToString() + ".json");
                var serializer = new JavaScriptSerializer();
                Receipt receipt;
                if (File.Exists(path)) {
                    receipt = serializer.Deserialize<Receipt>(File.ReadAllText(path));
                    if (receipt.MemberId != memberId || receipt.TerminalId != terminalId || receipt.Username != username)
                        return Result("conflict", "İşlem bilgileri değişmiş. Yeni bir işlem başlat.");
                    if (receipt.Status == "pending" && Confirmed(database, client, receipt, null)) {
                        receipt.Status = "started";
                        Save(path, receipt);
                    }
                    return Result(receipt.Status, receipt.Message);
                }
                foreach (string priorPath in Directory.GetFiles(directory,"*.json")) {
                    var prior=serializer.Deserialize<Receipt>(File.ReadAllText(priorPath));
                    if(prior.Status=="pending" && (prior.MemberId==memberId || prior.TerminalId==terminalId))
                        return Result("review","Önceki oturum açma işlemi sonuçlanmadı. Şube yetkilisinden kontrol etmesini iste.");
                }

                var terminal = Terminal(database, client, terminalId);
                if (terminal["ISVIRTUAL"] != "1" || terminal["TERMINALTYPE"] != "0")
                    return Result("unsupported", "Bu bağlantı yalnızca sanal masalarda oturum açabilir.");
                if (terminal["TERMINALSTATUS"] != "1")
                    return Result("occupied", "Bu bilgisayar artık boş değil. Başka bir bilgisayar seç.");
                var members = PanCafeReadOnly.Query(database, client,
                    "SELECT ID FROM MEMBERS WHERE ID=" + memberId + " AND USERNAME='" + username + "' AND ACCSTATUS=1 AND BAKIYE>0");
                if (members.Count != 1) return Result("member", "Üyeliğini ve bakiyeni kontrol et.");
                var active = PanCafeReadOnly.Query(database, client,
                    "SELECT FIRST 1 ID FROM TERMINALS WHERE MEMBERID=" + memberId + " AND TERMINALSTATUS=5");
                if (active.Count > 0) return Result("active", "Zaten açık bir üye oturumun var.");
                // PanCafe's search locates a username. Reject ambiguous partial
                // matches before opening its picker, including inactive accounts.
                var matches = PanCafeReadOnly.Query(database, client,
                    "SELECT COUNT(*) AS N FROM MEMBERS WHERE POSITION('" + username.ToLowerInvariant() + "' IN LOWER(USERNAME))>0");
                if (matches[0]["N"] != "1")
                    return Result("ambiguous", "Bu kullanıcı adı için kasadan oturum açılması gerekiyor.");

                NativeUi prepared;
                string beforeLog;
                try {
                    prepared=new NativeUi(database);
                    prepared.CheckIdle();
                    beforeLog=prepared.ReadLog();
                } catch(Exception error) {
                    File.WriteAllText(Path.Combine(folder,"session-readiness-error.json"),serializer.Serialize(new {
                        operationId=operation.ToString(),stage="before-submit",message=error.Message,at=DateTime.UtcNow.ToString("o") }));
                    string message=error is InvalidOperationException ? error.Message : "PanCafe yönetim ekranına ulaşılamadı. Yönetim ekranını kontrol et.";
                    receipt=new Receipt { OperationId=operation.ToString(),MemberId=memberId,TerminalId=terminalId,Username=username,Status="failed",Message=message };
                    Save(path,receipt);
                    return Result("failed",message);
                }
                using (var ui = prepared) {
                    receipt = new Receipt { OperationId = operation.ToString(), MemberId = memberId,
                        TerminalId = terminalId, Username = username, TerminalName = terminal["NAME"],
                        BeforeDate = terminal["STARTDATE"], BeforeTime = terminal["STARTTIME"], LogLength = beforeLog.Length,
                        CreatedAtUtc=DateTime.UtcNow.ToString("o") };
                    Save(path, receipt);
                    bool submitted = false;
                    try {
                        ui.Prepare(terminal["NAME"], username);
                        // The terminal may have become busy while the picker was opening.
                        if (Terminal(database, client, terminalId)["TERMINALSTATUS"] != "1")
                            throw new InvalidOperationException("Bu bilgisayar artık boş değil.");
                        submitted = true;
                        ui.Accept(username);
                        for (int attempt = 0; attempt < 24; attempt++) {
                            string log = ui.ReadLog();
                            if (log.StartsWith(beforeLog, StringComparison.Ordinal) &&
                                Confirmed(database, client, receipt, log.Substring(beforeLog.Length))) {
                                receipt.Status = "started";
                                Save(path, receipt);
                                return Result("started", "PanCafe'de üye oturumun başladı.");
                            }
                            Thread.Sleep(250);
                        }
                        receipt.Message = "İşlem sonucu henüz doğrulanamadı. Tekrar oturum açmadan şube yetkilisine başvur.";
                    } catch (Exception error) {
                        receipt.Status = submitted ? "pending" : "failed";
                        receipt.Message = error is InvalidOperationException ? error.Message : "PanCafe arayüzüne ulaşılamadı.";
                    } finally { ui.CancelPicker(); }
                    Save(path, receipt);
                    return Result(receipt.Status, receipt.Message);
                }
            } finally { mutex.ReleaseMutex(); }
        }
    }

    // This path never prepares the picker or submits a new native session.
    public static List<Dictionary<string,string>> Status(string database,string client,string folder,
        int terminalId,int memberId,string username,string operationId) {
        Guid operation;
        if(terminalId<1||memberId<1||!Guid.TryParse(operationId,out operation)||!Regex.IsMatch(username??"",@"\A[a-zA-Z0-9_.]{1,32}\z"))
            throw new ArgumentException("Invalid session request");
        using(var mutex=new Mutex(false,"Local\\STech-PanCafe-NativeSessions")) {
            bool acquired;try{acquired=mutex.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}
            if(!acquired)return Result("pending","PanCafe işlemi sürüyor. Biraz sonra durumu tekrar kontrol et.");
            try {
                string path=Path.Combine(folder,"session-operations",operation.ToString()+".json");
                if(!File.Exists(path))return Result("not_started","Bu işlem PanCafe’de başlatılmadı. Bilgisayarı yeniden seçebilirsin.");
                var receipt=new JavaScriptSerializer().Deserialize<Receipt>(File.ReadAllText(path));
                if(receipt.TerminalId!=terminalId||receipt.MemberId!=memberId||receipt.Username!=username)
                    return Result("conflict","İşlem bilgileri bu hesapla eşleşmiyor.");
                if(receipt.Status=="pending") {
                    try {if(Confirmed(database,client,receipt,null)){receipt.Status="started";Save(path,receipt);}}
                    catch { return Result("pending","Sonuç henüz doğrulanamadı. Şube yetkilisinden kontrol etmesini iste."); }
                }
                return Result(receipt.Status,receipt.Message);
            } finally {mutex.ReleaseMutex();}
        }
    }

    static Dictionary<string,string> Terminal(string db, string client, int id) {
        var rows = PanCafeReadOnly.Query(db, client,
            "SELECT ID,NAME,TERMINALTYPE,ISVIRTUAL,TERMINALSTATUS,MEMBERID,CAST(STARTDATE AS VARCHAR(30)) AS STARTDATE,CAST(STARTTIME AS VARCHAR(30)) AS STARTTIME FROM TERMINALS WHERE ID=" + id);
        if (rows.Count != 1) throw new InvalidOperationException("Bilgisayar bulunamadı.");
        return rows[0];
    }
    static bool Confirmed(string db, string client, Receipt receipt, string newLog) {
        var terminal = Terminal(db, client, receipt.TerminalId);
        if (terminal["ISVIRTUAL"] != "1" || terminal["TERMINALSTATUS"] != "5" ||
            terminal["MEMBERID"] != receipt.MemberId.ToString(CultureInfo.InvariantCulture) ||
            (terminal["STARTDATE"] == receipt.BeforeDate && terminal["STARTTIME"] == receipt.BeforeTime)) return false;
        if (newLog == null) {
            DateTime created;
            // A later cashier action must not be mistaken for this request.
            if(!DateTime.TryParse(receipt.CreatedAtUtc,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out created) ||
               DateTime.UtcNow-created.ToUniversalTime()>TimeSpan.FromMinutes(1)) return false;
            using (var ui = new NativeUi(db)) {
                var log = ui.ReadLog();
                if (log.Length < receipt.LogLength) return false;
                newLog = log.Substring(receipt.LogLength);
            }
        }
        return newLog.IndexOf(receipt.TerminalName + ": Üye oturumu başlatıldı. (Üye:" + receipt.Username + ")",
            StringComparison.OrdinalIgnoreCase) >= 0;
    }
    static void Save(string path, Receipt receipt) {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(receipt), new UTF8Encoding(false));
        if (File.Exists(path)) File.Replace(temporary, path, null);
        else File.Move(temporary, path);
    }
    static List<Dictionary<string,string>> Result(string code, string message) {
        return new List<Dictionary<string,string>> { new Dictionary<string,string> {
            { "RESULT_CODE", code }, { "MESSAGE", message ?? "" } } };
    }

    sealed class NativeUi : IDisposable {
        readonly IntPtr main, list, log;
        readonly uint processId;
        IntPtr picker;
        public NativeUi(string database) {
            string executable = Path.Combine(Directory.GetParent(Path.GetDirectoryName(database)).FullName, "pncserver.exe");
            var candidates = Windows("TSrvMainFrm", 0, true);
            var matches = new List<IntPtr>();
            foreach (var h in candidates) {
                uint id; GetWindowThreadProcessId(h, out id);
                using (var process = Process.GetProcessById((int)id)) {
                    if (String.Equals(process.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase)) matches.Add(h);
                }
            }
            if (matches.Count != 1) throw new InvalidOperationException("PanCafe yönetim ekranını açıp tekrar dene.");
            main = matches[0];
            GetWindowThreadProcessId(main, out processId);
            list = Child(main, "TspSkinListView", null);
            log = Child(main, "TspSkinRichEdit", null);
            bool supported = false;
            foreach (var h in Children(main)) if (Class(h) == "TspSkinStatusPanel" && Caption(h) == "v3.3.2") supported = true;
            if (!supported) throw new InvalidOperationException("Bu PanCafe sürümü için oturum açma bağlantısı doğrulanmamış.");
        }
        public void CheckIdle() {
            if (GetLastActivePopup(main) != main || Windows("TspSkinPopupWindow", processId, true).Count > 0)
                throw new InvalidOperationException("PanCafe'deki açık pencereyi veya menüyü kapatıp tekrar dene.");
            Activate(main);
        }
        public string ReadLog() { return Text(log); }
        public void Prepare(string terminal, string username) {
            using (var items = new RemoteList(list, processId)) {
                int selected = items.Find(terminal);
                items.Select(selected);
                Rect bounds = items.Bounds(selected);
                Click(main, list, (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2);
            }
            PostMessage(list, 0x7B, list, new IntPtr(-1));
            var context = WaitWindow("TspSkinPopupWindow", IntPtr.Zero);
            Rect contextRect; GetClientRect(context, out contextRect);
            MenuClick(context, contextRect.Right / 2, 12);
            var submenu = WaitWindow("TspSkinPopupWindow", context);
            Rect submenuRect; GetClientRect(submenu, out submenuRect);
            if (submenuRect.Bottom < 100 || submenuRect.Bottom > 350)
                throw new InvalidOperationException("PanCafe oturum menüsü beklenen düzende değil.");
            MenuClick(submenu, submenuRect.Right / 2, submenuRect.Bottom * 7 / 12);
            picker = WaitWindow("TSrvMemberSearchDlgFrm", IntPtr.Zero);
            bool usernameSearch = false;
            foreach (var h in Children(picker)) if (Class(h) == "TspSkinComboBox" && Caption(h) == "Kullanıcı Adı") usernameSearch = true;
            if (!usernameSearch) throw new InvalidOperationException("PanCafe arama kriterini Kullanıcı Adı olarak seç.");
            var edit = Child(picker, "TspSkinEdit", null);
            Click(picker, edit, 10, 10);
            CheckFocus(edit);
            Key(17, false); Key(65, false); Key(65, true); Key(17, true);
            Key(8, false); Key(8, true);
            foreach (char letter in username) {
                CheckFocus(edit);
                var down = new KeyboardInput { Type=1, Scan=letter, Flags=4 };
                var up = new KeyboardInput { Type=1, Scan=letter, Flags=6 };
                if (SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(KeyboardInput))) != 2)
                    throw new InvalidOperationException("PanCafe üye araması yapılamadı.");
                Thread.Sleep(40);
            }
            Thread.Sleep(400);
            if (Text(edit) != username) throw new InvalidOperationException("PanCafe üye araması doğrulanamadı.");
        }
        public void Accept(string username) {
            if (!IsWindowVisible(picker) || Text(Child(picker, "TspSkinEdit", null)) != username)
                throw new InvalidOperationException("PanCafe üye seçimi değişmiş.");
            Activate(picker);
            CheckFocus(Child(picker,"TspSkinEdit",null));
            Key(13,false); Key(13,true);
            Thread.Sleep(500);
        }
        public void CancelPicker() {
            if (picker != IntPtr.Zero && IsWindowVisible(picker)) PostMessage(picker, 0x10, IntPtr.Zero, IntPtr.Zero);
            PostMessage(main, 0x1F, IntPtr.Zero, IntPtr.Zero);
        }
        public void Dispose() { }
        IntPtr WaitWindow(string kind, IntPtr excluded) {
            for (int i = 0; i < 20; i++) {
                var matches = Windows(kind, processId, true);
                matches.Remove(excluded);
                if (matches.Count == 1) return matches[0];
                if (matches.Count > 1) break;
                Thread.Sleep(100);
            }
            throw new InvalidOperationException("PanCafe oturum penceresi açılamadı.");
        }
    }

    static void MenuClick(IntPtr h, int x, int y) {
        var point = new IntPtr((y << 16) | (x & 65535));
        PostMessage(h, 0x200, IntPtr.Zero, point);
        PostMessage(h, 0x201, new IntPtr(1), point);
        PostMessage(h, 0x202, IntPtr.Zero, point);
        Thread.Sleep(250);
    }
    static void Key(ushort key,bool up) {
        var input=new KeyboardInput { Type=1,VirtualKey=key,Flags=up?2u:0u };
        if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(KeyboardInput)))!=1)
            throw new InvalidOperationException("PanCafe klavye komutu gönderilemedi.");
    }
    static void CheckFocus(IntPtr edit) {
        uint ignored; uint thread=GetWindowThreadProcessId(edit,out ignored);
        var info=new GuiThreadInfo { Size=(uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
        if(!GetGUIThreadInfo(thread,ref info)||info.Focus!=edit)
            throw new InvalidOperationException("PanCafe üye araması sırasında odak değişti. Tekrar dene.");
    }
    static void Activate(IntPtr h) {
        if (GetForegroundWindow() == h) return;
        // The HTTP worker has no message loop. AttachThreadInput requires one.
        NativeMessage message; PeekMessage(out message,IntPtr.Zero,0,0,0);
        uint ignored;
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint target = GetWindowThreadProcessId(h,out ignored);
        uint current = GetCurrentThreadId();
        bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        bool targetAttached=target!=0 && target!=current && target!=foreground && AttachThreadInput(current,target,true);
        try {
            ShowWindow(h, 9);
            if (!SetForegroundWindow(h)) throw new InvalidOperationException("PanCafe yönetim ekranını öne getirip tekrar dene.");
        } finally {
            if(targetAttached)AttachThreadInput(current,target,false);
            if (attached) AttachThreadInput(current, foreground, false);
        }
        Thread.Sleep(120);
    }
    static void Click(IntPtr root, IntPtr target, int x, int y) {
        Activate(root);
        Point point = new Point { X = x, Y = y }, before;
        if (!IsWindowVisible(target) || !ClientToScreen(target, ref point) || !GetCursorPos(out before))
            throw new InvalidOperationException("PanCafe kontrolüne ulaşılamadı.");
        if (!SetCursorPos(point.X, point.Y)) throw new InvalidOperationException("PanCafe kontrolü seçilemedi.");
        try {
            Thread.Sleep(60);
            if (WindowFromPoint(point) != target) throw new InvalidOperationException("PanCafe ekranının önünde başka bir pencere var.");
            mouse_event(2, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            mouse_event(4, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(150);
        } finally { SetCursorPos(before.X, before.Y); }
    }
    static string Class(IntPtr h) { var value = new StringBuilder(256); GetClassName(h, value, value.Capacity); return value.ToString(); }
    static string Caption(IntPtr h) { var value = new StringBuilder(256); GetWindowText(h, value, value.Capacity); return value.ToString(); }
    static string Text(IntPtr h) {
        long length = Message(h, 14, 0, IntPtr.Zero);
        if (length < 0 || length > 524288) throw new InvalidOperationException("PanCafe kontrol verisi okunamadı.");
        var value = new StringBuilder((int)length + 1);
        IntPtr result;
        if (SendText(h, 13, new IntPtr(value.Capacity), value, 2, 2000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("PanCafe kontrol verisi okunamadı.");
        return value.ToString();
    }
    static long Message(IntPtr h, uint message, long w, IntPtr l) {
        IntPtr result;
        if (SendMessageTimeout(h, message, new IntPtr(w), l, 2, 2000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("PanCafe komutuna yanıt alınamadı.");
        return result.ToInt64();
    }
    static List<IntPtr> Windows(string kind, uint pid, bool visible) {
        var result = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr data) {
            uint owner; GetWindowThreadProcessId(h, out owner);
            if ((pid == 0 || owner == pid) && (!visible || IsWindowVisible(h)) && Class(h) == kind) result.Add(h);
            return true;
        }, IntPtr.Zero);
        return result;
    }
    static List<IntPtr> Children(IntPtr parent) {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr h, IntPtr data) { if (IsWindowVisible(h)) result.Add(h); return true; }, IntPtr.Zero);
        return result;
    }
    static IntPtr Child(IntPtr parent, string kind, string caption) {
        var matches = Children(parent).FindAll(delegate(IntPtr h) { return Class(h) == kind && (caption == null || Caption(h) == caption); });
        if (matches.Count != 1) throw new InvalidOperationException("PanCafe ekran düzeni doğrulanamadı.");
        return matches[0];
    }

    sealed class RemoteList : IDisposable {
        readonly IntPtr process, memory, list;
        public RemoteList(IntPtr list, uint pid) {
            this.list = list;
            process = OpenProcess(0x38, false, pid);
            if (process == IntPtr.Zero) throw new InvalidOperationException("PanCafe bağlantısını yönetici izniyle aç.");
            memory = VirtualAllocEx(process, IntPtr.Zero, new UIntPtr(1024), 0x3000, 4);
            if (memory == IntPtr.Zero) { CloseHandle(process); throw new InvalidOperationException("PanCafe kontrol belleği hazırlanamadı."); }
        }
        void Write(byte[] value) { UIntPtr size; if (!WriteProcessMemory(process, memory, value, new UIntPtr((uint)value.Length), out size)) throw new InvalidOperationException("PanCafe liste kontrolüne ulaşılamadı."); }
        byte[] Read(int offset, int length) { var value = new byte[length]; UIntPtr size; if (!ReadProcessMemory(process, new IntPtr(memory.ToInt32() + offset), value, new UIntPtr((uint)length), out size)) throw new InvalidOperationException("PanCafe listesi okunamadı."); return value; }
        public int Find(string name) {
            int count = (int)Message(list, 0x1004, 0, IntPtr.Zero), index = -1;
            if (count < 0 || count > 5000) throw new InvalidOperationException("PanCafe terminal listesi geçersiz.");
            for (int i = 0; i < count; i++) {
                var value = new byte[1024];
                Array.Copy(BitConverter.GetBytes(memory.ToInt32() + 64), 0, value, 20, 4);
                Array.Copy(BitConverter.GetBytes(400), 0, value, 24, 4);
                Write(value); Message(list, 0x1073, i, memory);
                string actual = Encoding.Unicode.GetString(Read(64, 800)).Split('\0')[0];
                if (actual != name) continue;
                if (index >= 0) throw new InvalidOperationException("Birden fazla bilgisayar aynı adı kullanıyor.");
                index = i;
            }
            if (index < 0) throw new InvalidOperationException("Bilgisayar PanCafe ekranında bulunamadı.");
            return index;
        }
        public void Select(int index) {
            var value = new byte[64];
            Array.Copy(BitConverter.GetBytes(3), 0, value, 16, 4);
            Write(value); Message(list, 0x102B, -1, memory);
            Array.Copy(BitConverter.GetBytes(3), 0, value, 12, 4);
            Write(value); Message(list, 0x102B, index, memory);
            Message(list, 0x1043, 0, new IntPtr(index));
        }
        public Rect Bounds(int index) {
            Write(new byte[16]);
            if (Message(list, 0x100E, index, memory) == 0) throw new InvalidOperationException("Bilgisayar ekranda görünmüyor.");
            var value = Read(0, 16);
            return new Rect { Left = BitConverter.ToInt32(value, 0), Top = BitConverter.ToInt32(value, 4), Right = BitConverter.ToInt32(value, 8), Bottom = BitConverter.ToInt32(value, 12) };
        }
        public void Dispose() { VirtualFreeEx(process, memory, UIntPtr.Zero, 0x8000); CloseHandle(process); }
    }

    delegate bool Callback(IntPtr h, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct NativeMessage { public IntPtr Window; public uint Message;public UIntPtr WParam;public IntPtr LParam;public uint Time;public Point Position;public uint Private; }
    [DllImport("user32.dll")] static extern bool PeekMessage(out NativeMessage message,IntPtr window,uint min,uint max,uint flags);
    [StructLayout(LayoutKind.Sequential)] struct GuiThreadInfo { public uint Size,Flags; public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret; public Rect CaretRect; }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [StructLayout(LayoutKind.Sequential)] struct KeyboardInput { public uint Type; public ushort VirtualKey,Scan; public uint Flags,Time; public UIntPtr Extra; public uint Padding1,Padding2; }
    [DllImport("user32.dll")] static extern uint SendInput(uint count,KeyboardInput[] inputs,int size);
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder value, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder value, int size);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr h, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SendText(IntPtr h, uint message, IntPtr w, StringBuilder text, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out Rect value);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref Point point);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint type, uint protect);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] value, UIntPtr size, out UIntPtr count);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] value, UIntPtr size, out UIntPtr count);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint type);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
