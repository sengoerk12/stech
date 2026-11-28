using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// Starts member sessions through the operator's PanCafe UI, not by
// editing TERMINALS. The guarded UI path sends messages to PanCafe's specific controls.
// Only the verified Turkish v3.3.2 layout is supported.
public static partial class PanCafeNativeSessions {
    const string WakingMessage = "Bilgisayarınız açılıyor. PanCafe bağlantısı bekleniyor…";
    const string OperatorWaitMessage = "PanCafe hazır olduğunda işlem otomatik devam edecek…";
    const string PendingMessage = "PanCafe’de oturumunuz başlatılıyor…";
    const string InsufficientBalance = "Bakiyeniz yetersiz. En az 10 TL gerekli.";
    static readonly TimeSpan UnattendedWait = TimeSpan.FromMinutes(10);
    static readonly TimeSpan ConfirmationWait = TimeSpan.FromMinutes(2);
    static readonly HashSet<Guid> Running = new HashSet<Guid>();

    public sealed class Receipt {
        public string OperationId, Username, TerminalName, BeforeDate, BeforeTime, CreatedAtUtc;
        public string LastPollUtc, LastWakeUtc, TerminalMac;
        public int MemberId, TerminalId;
        public string InputMode;
        public bool StartedWhileOffline, WaitingForOperator;
        public string Status = "pending", Message = "";
    }

    static Receipt ReadReceipt(string path) {
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var reader = new StreamReader(stream))
            return new JavaScriptSerializer().Deserialize<Receipt>(reader.ReadToEnd());
    }

    internal static HashSet<int> ReservedTerminals(string folder) {
        var result = new HashSet<int>();
        string directory = Path.Combine(folder, "session-operations");
        if (!Directory.Exists(directory)) return result;
        foreach (string path in Directory.EnumerateFiles(directory, "*.json")) {
            var receipt = ReadReceipt(path);
            if ((receipt.Status == "waking" && !OlderThan(receipt.LastPollUtc, UnattendedWait)) ||
                (receipt.Status == "pending" && !OlderThan(receipt.CreatedAtUtc, receipt.StartedWhileOffline ? UnattendedWait : ConfirmationWait)))
                result.Add(receipt.TerminalId);
        }
        return result;
    }

    public static List<Dictionary<string,string>> Start(string database, string client,
        string folder, int terminalId, int memberId, string username, string operationId) {
        Guid operation;
        if (terminalId < 1 || memberId < 1 || !Guid.TryParse(operationId, out operation) ||
            !Regex.IsMatch(username ?? "", @"\A[a-zA-Z0-9_.]{1,32}\z"))
            throw new ArgumentException("Invalid session request");

        var result = Advance(database, client, folder, terminalId, memberId, username, operation, false);
        if (IsWaiting(result)) {
            bool schedule;
            lock (Running) schedule = Running.Add(operation);
            if (schedule) {
                // The bridge owns an accepted start even if the kiosk sends no further requests.
                Task.Run(() => Continue(database, client, folder, terminalId, memberId, username, operation));
            }
        }
        return result;
    }

    static bool IsWaiting(List<Dictionary<string,string>> result) {
        string status = result[0]["RESULT_CODE"];
        return status == "waking" || status == "pending";
    }

    static async Task Continue(string database, string client, string folder, int terminalId,
        int memberId, string username, Guid operation) {
        var elapsed = Stopwatch.StartNew();
        try {
            while (true) {
                await Task.Delay(3000).ConfigureAwait(false);
                try {
                    if (!IsWaiting(Advance(database, client, folder, terminalId, memberId, username, operation, true))) return;
                } catch (Exception error) {
                    Trace.TraceWarning("PanCafe session {0} retry failed: {1}", operation, error.GetType().Name);
                }
                if (elapsed.Elapsed >= UnattendedWait) return;
            }
        } finally {
            lock (Running) Running.Remove(operation);
        }
    }

    static List<Dictionary<string,string>> Advance(string database, string client, string folder,
        int terminalId, int memberId, string username, Guid operation, bool background) {
        using (var mutex = new Mutex(false, "Local\\STech-PanCafe-NativeSessions")) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return Result("pending", "");
            OperatorInputScope input = null;
            try {
                string directory = Path.Combine(folder, "session-operations");
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, operation.ToString() + ".json");
                var serializer = new JavaScriptSerializer();
                Receipt receipt = null;
                if (File.Exists(path)) {
                    receipt = serializer.Deserialize<Receipt>(File.ReadAllText(path));
                    if (receipt.MemberId != memberId || receipt.TerminalId != terminalId || receipt.Username != username)
                        return Result("conflict", "İşlem bilgileri değişmiş. Yeni bir işlem başlat.");
                    if (receipt.Status != "waking") return Observe(database, client, path, receipt);
                    if (OlderThan(receipt.LastPollUtc, UnattendedWait))
                        return Finish(path, receipt, "failed", "Bilgisayar açılış isteği sona erdi. Yeniden deneyebilirsin.");
                    if (!background) {
                        receipt.LastPollUtc = DateTime.UtcNow.ToString("o");
                        Save(path, receipt);
                        return Waiting(receipt);
                    }
                }
                if (receipt == null) {
                    foreach (string priorPath in Directory.EnumerateFiles(directory, "*.json")) {
                        var prior = ReadReceipt(priorPath);
                        if (prior.MemberId != memberId && prior.TerminalId != terminalId) continue;
                        if (prior.Status == "waking" && OlderThan(prior.LastPollUtc, TimeSpan.FromSeconds(30))) {
                            Guid priorOperation;
                            bool tracked;
                            lock (Running) tracked = Guid.TryParse(prior.OperationId, out priorOperation) && Running.Contains(priorOperation);
                            if (!tracked) Finish(priorPath, prior, "failed", "Açılış isteği artık takip edilmiyor.");
                        }
                        if (prior.Status == "pending") Observe(database, client, priorPath, prior);
                        if (prior.Status == "pending" || prior.Status == "waking")
                            return Result("busy", "Bu üye veya bilgisayar için bir oturum işlemi sürüyor.");
                    }
                }

                var terminal = Terminal(database, client, terminalId);
                if (terminal["TERMINALTYPE"] != "0" || (terminal["ISVIRTUAL"] != "1" && terminal["ISVIRTUAL"] != "0"))
                    return Finish(path, receipt, "unsupported", "Bu terminalde kiosktan üye oturumu açılamıyor.");
                if (terminal["ISVIRTUAL"] == "0" && terminal["NOMEMBERLOGIN"] != "0")
                    return Finish(path, receipt, "unsupported", "Bu bilgisayarda üye oturumu kapalı.");
                bool needsWake = !IsOnline(database, terminal);
                if (receipt != null && (terminal["NAME"] != receipt.TerminalName ||
                    terminal["MAC"] != receipt.TerminalMac || (!receipt.WaitingForOperator && terminal["ISVIRTUAL"] != "0")))
                    return Finish(path, receipt, "failed", "Bilgisayarın PanCafe ayarları değişti.");
                if (terminal["TERMINALSTATUS"] != "1" &&
                    (!(needsWake || receipt != null) || terminal["TERMINALSTATUS"] != "0"))
                    return Finish(path, receipt, "occupied", "Bu bilgisayar artık boş değil. Başka bir bilgisayar seç.");
                string balanceCheck = CheckMemberBalance(database, client, memberId, username);
                if (balanceCheck != null) return Finish(path, receipt, balanceCheck,
                    balanceCheck == "insufficient_balance" ? InsufficientBalance : "Üyeliğini kontrol et.");
                var active = PanCafeReadOnly.Query(database, client,
                    "SELECT FIRST 1 ID FROM TERMINALS WHERE MEMBERID=" + memberId + " AND TERMINALSTATUS=5");
                if (active.Count > 0) return Finish(path, receipt, "active", "Zaten açık bir üye oturumun var.");
                // PanCafe's search locates a username. Reject ambiguous partial
                // matches before opening its picker, including inactive accounts.
                var matches = PanCafeReadOnly.Query(database, client,
                    "SELECT COUNT(*) AS N FROM MEMBERS WHERE POSITION('" + username.ToLowerInvariant() + "' IN LOWER(USERNAME))>0");
                if (matches[0]["N"] != "1")
                    return Finish(path, receipt, "ambiguous", "Bu kullanıcı adı için kasadan oturum açılması gerekiyor.");

                if (receipt != null && (needsWake || terminal["TERMINALSTATUS"] == "0"))
                    return WakeForSession(path, receipt, terminal, needsWake);

                NativeUi prepared;
                try {
                    input = new OperatorInputScope();
                    prepared=new NativeUi(database);
                    prepared.CheckIdle();
                    prepared.OpenTerminalScreen(terminal["NAME"]);
                } catch (OperatorBusyException) {
                    return WaitForOperator(path, receipt ?? NewWakeReceipt(operation, terminal, terminalId, memberId, username), terminal, needsWake);
                } catch(Exception error) {
                    File.WriteAllText(Path.Combine(folder,"session-readiness-error.json"),serializer.Serialize(new {
                        operationId=operation.ToString(),stage="before-submit",message=error.Message,at=DateTime.UtcNow.ToString("o") }));
                    string message=error is InvalidOperationException ? error.Message : "PanCafe yönetim ekranına ulaşılamadı. Yönetim ekranını kontrol et.";
                    if (needsWake) return WakeForSession(path, NewWakeReceipt(operation, terminal, terminalId, memberId, username), terminal, true);
                    return receipt == null ? Result("failed", message) : Result("waking", WakingMessage);
                }
                using (var ui = prepared) {
                    try {
                        bool physical = terminal["ISVIRTUAL"] == "0";
                        if (physical) ui.Background = false;
                        try { ui.Prepare(terminal["NAME"], username, physical); }
                        catch (OperatorBusyException) { throw; }
                        catch (InvalidOperationException) {
                            if (!ui.Background) throw;
                            // Reopen the menu with the verified foreground layout.
                            // The guarded attempt still sends messages to the selected controls.
                            ui.CancelPicker();
                            Thread.Sleep(600);
                            ui.Background = false;
                            ui.CheckIdle();
                            ui.Prepare(terminal["NAME"], username, physical);
                        }
                        // The terminal may have become busy while the picker was opening.
                        var current = Terminal(database, client, terminalId);
                        bool online = IsOnline(database, current);
                        if (receipt != null && (!online || current["TERMINALSTATUS"] == "0"))
                            return Result("waking", WakingMessage);
                        if (!CanSubmit(current, terminal, needsWake && !online))
                            return Finish(path, receipt, "occupied", "Bu bilgisayar artık boş değil.");
                        balanceCheck = CheckMemberBalance(database, client, memberId, username);
                        if (balanceCheck != null) return Finish(path, receipt, balanceCheck,
                            balanceCheck == "insufficient_balance" ? InsufficientBalance : "Üyeliğini kontrol et.");
                        if (!MemberCanStart(database, client, memberId, username))
                            return Finish(path, receipt, "member", "Üyeliğini, bakiyeni ve açık oturumlarını kontrol et.");
                        var submission = new Receipt { OperationId = operation.ToString(), MemberId = memberId,
                            TerminalId = terminalId, Username = username, TerminalName = current["NAME"],
                            BeforeDate = current["STARTDATE"], BeforeTime = current["STARTTIME"],
                            CreatedAtUtc = DateTime.UtcNow.ToString("o"),
                            InputMode = ui.Background ? "background" : "foreground",
                            StartedWhileOffline = !online };
                        // Persist after checking the target and before posting the confirmation.
                        ui.Accept(username, physical, () => {
                            Save(path, submission);
                            receipt = submission;
                        });
                        if (!online && !IsOnline(database, current)) PanCafeConnectedTerminals.Wake(current["MAC"]);
                        return Observe(database, client, path, receipt);
                    } catch (OperatorBusyException) {
                        // After recording a possible submission, observe PanCafe rather than dispatch twice.
                        if (receipt != null && receipt.Status == "pending")
                            return Result("pending", PendingMessage);
                        return WaitForOperator(path, receipt ?? NewWakeReceipt(operation, terminal, terminalId, memberId, username), terminal, needsWake);
                    } catch (Exception error) {
                        File.WriteAllText(Path.Combine(folder,"session-readiness-error.json"),serializer.Serialize(new {
                            operationId=operation.ToString(),stage=receipt != null && receipt.Status == "pending" ? "submit" : "prepare",
                            message=error.Message,at=DateTime.UtcNow.ToString("o") }));
                        if (receipt != null && receipt.Status == "pending")
                            return Result("pending", PendingMessage);
                        if (receipt != null) return Result("waking", WakingMessage);
                        if (needsWake) return WakeForSession(path, NewWakeReceipt(operation, terminal, terminalId, memberId, username), terminal, true);
                        return Finish(path, receipt, "failed", error is InvalidOperationException ?
                            error.Message : "PanCafe arayüzüne ulaşılamadı.");
                    } finally { ui.CancelPicker(); }
                }
            } finally {
                if (input != null) input.Dispose();
                mutex.ReleaseMutex();
            }
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
                return Observe(database, client, path, receipt);
            } finally {mutex.ReleaseMutex();}
        }
    }

    static Dictionary<string,string> Terminal(string db, string client, int id) {
        var terminal = FindTerminal(db, client, id);
        if (terminal == null) throw new InvalidOperationException("Bilgisayar bulunamadı.");
        return terminal;
    }
    static Dictionary<string,string> FindTerminal(string db, string client, int id) {
        var rows = PanCafeReadOnly.Query(db, client,
            "SELECT ID,NAME,TERMINALTYPE,ISVIRTUAL,TERMINALSTATUS,NOMEMBERLOGIN,MAC,MEMBERID,CAST(STARTDATE AS VARCHAR(30)) AS STARTDATE,CAST(STARTTIME AS VARCHAR(30)) AS STARTTIME FROM TERMINALS WHERE ID=" + id);
        if (rows.Count != 1) return null;
        var row = rows[0];
        if (row["ISVIRTUAL"] == "0") row["MAC"] = PanCafeConnectedTerminals.WakeAddress(db, row["NAME"], row["MAC"]);
        return row;
    }
    static bool IsOnline(string database, Dictionary<string,string> terminal) {
        return terminal["ISVIRTUAL"] == "1" || PanCafeConnectedTerminals.Read(database).Contains(terminal["NAME"]);
    }
    static Receipt NewWakeReceipt(Guid operation, Dictionary<string,string> terminal, int terminalId, int memberId, string username) {
        return new Receipt { OperationId = operation.ToString(), MemberId = memberId,
            TerminalId = terminalId, Username = username, TerminalName = terminal["NAME"],
            TerminalMac = terminal["MAC"], Status = "waking", LastPollUtc = DateTime.UtcNow.ToString("o") };
    }
    static List<Dictionary<string,string>> WaitForOperator(string path, Receipt receipt, Dictionary<string,string> terminal, bool needsWake) {
        receipt.WaitingForOperator = true;
        Save(path, receipt);
        return WakeForSession(path, receipt, terminal, needsWake);
    }
    static List<Dictionary<string,string>> Waiting(Receipt receipt) {
        return receipt.WaitingForOperator
            ? Result("pending", OperatorWaitMessage)
            : Result("waking", WakingMessage);
    }
    static List<Dictionary<string,string>> WakeForSession(string path, Receipt receipt, Dictionary<string,string> terminal, bool needsWake) {
        if (needsWake && OlderThan(receipt.LastWakeUtc, TimeSpan.FromSeconds(20))) {
            if (PanCafeConnectedTerminals.WakePacket(terminal["MAC"]) == null)
                return Finish(path, receipt, "failed", "Bilgisayarın açılma ayarı eksik.");
            receipt.LastWakeUtc = DateTime.UtcNow.ToString("o");
            Save(path, receipt);
            PanCafeConnectedTerminals.Wake(terminal["MAC"]);
        }
        return Waiting(receipt);
    }
    static bool CanSubmit(Dictionary<string,string> current, Dictionary<string,string> original, bool allowOffline) {
        return (current["TERMINALSTATUS"] == "1" || (allowOffline && current["TERMINALSTATUS"] == "0")) && current["NAME"] == original["NAME"] &&
            current["ISVIRTUAL"] == original["ISVIRTUAL"] && current["TERMINALTYPE"] == "0" &&
            (current["ISVIRTUAL"] == "1" || (current["NOMEMBERLOGIN"] == "0" && current["MAC"] == original["MAC"]));
    }
    static string CheckMemberBalance(string database, string client, int memberId, string username) {
        var rows = PanCafeReadOnly.Query(database, client,
            "SELECT CASE WHEN BAKIYE>=10 THEN 1 ELSE 0 END AS CAN_START FROM MEMBERS WHERE ID=" +
            memberId + " AND USERNAME='" + username + "' AND ACCSTATUS=1");
        return rows.Count != 1 ? "member" : rows[0]["CAN_START"] == "1" ? null : "insufficient_balance";
    }
    static bool MemberCanStart(string database, string client, int memberId, string username) {
        return PanCafeReadOnly.Query(database, client,
            "SELECT ID FROM MEMBERS WHERE ID=" + memberId + " AND USERNAME='" + username +
            "' AND ACCSTATUS=1 AND BAKIYE>=10 AND NOT EXISTS(SELECT 1 FROM TERMINALS WHERE MEMBERID=" +
            memberId + " AND TERMINALSTATUS=5)").Count == 1;
    }
    static bool OlderThan(string value, TimeSpan age) {
        DateTime timestamp;
        return !DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out timestamp)
            || DateTime.UtcNow - timestamp.ToUniversalTime() >= age;
    }
    static List<Dictionary<string,string>> Observe(string db, string client, string path, Receipt receipt) {
        if (receipt.Status == "waking") {
            if (receipt.WaitingForOperator && OlderThan(receipt.LastPollUtc, UnattendedWait))
                return Finish(path, receipt, "failed", "PanCafe bekleme süresi doldu. Bilgisayarı yeniden seçebilirsin.");
            return Waiting(receipt);
        }
        if (receipt.Status != "pending") return Result(receipt.Status, receipt.Message);

        var terminal = FindTerminal(db, client, receipt.TerminalId);
        if (terminal == null)
            return Finish(path, receipt, "failed", "Bilgisayar bulunamadı.");
        string status = terminal["TERMINALSTATUS"];
        bool sameTerminal = terminal["TERMINALTYPE"] == "0" && terminal["NAME"] == receipt.TerminalName;
        if (sameTerminal && status == "5" &&
            terminal["MEMBERID"] == receipt.MemberId.ToString(CultureInfo.InvariantCulture) &&
            (terminal["STARTDATE"] != receipt.BeforeDate || terminal["STARTTIME"] != receipt.BeforeTime))
            return Finish(path, receipt, "started", "PanCafe’de üye oturumun başladı.");
        if (!sameTerminal || (status == "5" &&
            terminal["MEMBERID"] != receipt.MemberId.ToString(CultureInfo.InvariantCulture)))
            return Finish(path, receipt, "occupied", "Bu bilgisayar artık oturum açmaya uygun değil.");

        // Only retire a submitted request once PanCafe shows that the terminal is free.
        // The boot wait is a separate state and has no time limit while it is polled.
        bool waitingForBoot = receipt.StartedWhileOffline && !IsOnline(db, terminal);
        if ((status == "0" || status == "1") && OlderThan(receipt.CreatedAtUtc,
                receipt.StartedWhileOffline ? UnattendedWait : ConfirmationWait))
            return Finish(path, receipt, "failed", "PanCafe oturumu başlamadı. Bilgisayarı yeniden seçebilirsin.");
        return waitingForBoot ? Result("waking", WakingMessage) : Result("pending", PendingMessage);
    }
    static List<Dictionary<string,string>> Finish(string path, Receipt receipt, string status, string message) {
        if (receipt != null) {
            receipt.Status = status;
            receipt.Message = message;
            Save(path, receipt);
        }
        return Result(status, message);
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

    sealed class NativeWindowUnavailableException : InvalidOperationException {
        public NativeWindowUnavailableException(string message) : base(message) { }
    }

    sealed partial class NativeUi : IDisposable {
        readonly IntPtr main;
        IntPtr list;
        readonly uint processId;
        IntPtr picker;
        bool sessionMenuOpened;
        // Background mode uses a targeted click on the terminal list. The foreground
        // fallback also checks that the control is unobstructed before posting its click.
        public bool Background = Environment.GetEnvironmentVariable("STECH_PANCAFE_FOREGROUND_INPUT") != "1";
        public NativeUi(string database) {
            string executable = Path.Combine(Directory.GetParent(Path.GetDirectoryName(database)).FullName, "pncserver.exe");
            var candidates = Windows("TSrvMainFrm", 0, false);
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
            if (operatorInput != null) operatorInput.PanCafeProcess = processId;
            bool supported = false;
            foreach (var h in Children(main, false)) if (Class(h) == "TspSkinStatusPanel" && Caption(h) == "v3.3.2") supported = true;
            if (!supported) throw new InvalidOperationException("Bu PanCafe sürümü için oturum açma bağlantısı doğrulanmamış.");
        }
        public void CheckIdle() {
            RestoreWindow(main);
            var members = MemberWindow();
            var popup = GetLastActivePopup(main);
            if ((popup != main && popup != members && IsWindowVisible(popup)) ||
                (!IsWindowEnabled(main) && members == IntPtr.Zero) ||
                Windows("TspSkinPopupWindow", processId, true).Count > 0) {
                if (OperatorInputScope.IsActive) throw new OperatorBusyException();
                throw new InvalidOperationException("PanCafe'deki açık pencereyi veya menüyü kapatıp tekrar dene.");
            }
            Activate(members == IntPtr.Zero ? main : members);
        }
        public void Prepare(string terminal, string username, bool physical) {
            CheckOperatorInput();
            using (var items = new RemoteList(list, processId)) {
                int selected = items.Find(terminal);
                items.Select(selected);
                Rect bounds = items.Bounds(selected);
                if (Background) MenuClick(list, (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2);
                else Click(main, list, (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2);
            }
            CheckOperatorInput();
            if (!PostMessage(list, 0x7B, list, new IntPtr(-1)))
                throw new InvalidOperationException("PanCafe oturum menüsü açılamadı.");
            sessionMenuOpened = true;
            var context = WaitWindow("TspSkinPopupWindow", IntPtr.Zero);
            Rect contextRect; GetClientRect(context, out contextRect);
            MenuClick(context, contextRect.Right / 2, 12);
            var submenu = WaitWindow("TspSkinPopupWindow", context);
            Rect submenuRect; GetClientRect(submenu, out submenuRect);
            if (submenuRect.Bottom < 100 || submenuRect.Bottom > 350)
                throw new InvalidOperationException("PanCafe oturum menüsü beklenen düzende değil.");
            // The physical terminal menu has six items and a separator before member login.
            int memberRow = physical ? submenuRect.Bottom * 3 / 5 : submenuRect.Bottom * 7 / 12;
            MenuClick(submenu, submenuRect.Right / 2, memberRow);
            picker = WaitWindow("TSrvMemberSearchDlgFrm", IntPtr.Zero);
            PrepareMemberSearch(username);
        }
        void PrepareMemberSearch(string username) {
            bool usernameSearch = false;
            foreach (var h in Children(picker)) if (Class(h) == "TspSkinComboBox" && Caption(h) == "Kullanıcı Adı") usernameSearch = true;
            if (!usernameSearch) throw new InvalidOperationException("PanCafe arama kriterini Kullanıcı Adı olarak seç.");
            var edit = Child(picker, "TspSkinEdit", null);
            WriteControlText(picker, edit, username, true);
            Thread.Sleep(400);
            if (Text(edit) != username) throw new InvalidOperationException("PanCafe üye araması doğrulanamadı.");
        }
        public void Accept(string username, bool preferResult = false, Action recordSubmission = null) {
            CheckOperatorInput();
            if (!IsWindowVisible(picker)) throw new InvalidOperationException("PanCafe üye seçimi değişmiş.");
            var edit = Child(picker, "TspSkinEdit", null);
            if (Text(edit) != username) throw new InvalidOperationException("PanCafe üye seçimi değişmiş.");
            IntPtr results;
            int row;
            if (preferResult && FindRow(picker, username, true, out results, out row)) {
                using (var items = new RemoteList(results, processId)) {
                    items.Select(row);
                    var bounds = items.Bounds(row);
                    Click(picker, results, (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2, true, recordSubmission);
                }
                return;
            }
            FocusControl(picker, edit);
            if (Text(edit) != username) throw new InvalidOperationException("PanCafe üye seçimi değişmiş.");
            PostControlKey(edit, 13, 0x1C, recordSubmission);
        }
        public void CancelPicker() {
            if (picker != IntPtr.Zero && IsWindowVisible(picker)) PostMessage(picker, 0x10, IntPtr.Zero, IntPtr.Zero);
            if (sessionMenuOpened) PostMessage(main, 0x1F, IntPtr.Zero, IntPtr.Zero);
            picker = IntPtr.Zero;
            sessionMenuOpened = false;
        }
        public void Dispose() { }
        IntPtr WaitWindow(string kind, IntPtr excluded) {
            for (int i = 0; i < 20; i++) {
                CheckOperatorInput();
                var matches = Windows(kind, processId, true);
                matches.Remove(excluded);
                if (matches.Count == 1) return matches[0];
                if (matches.Count > 1) break;
                Thread.Sleep(100);
            }
            throw new InvalidOperationException("PanCafe oturum penceresi açılamadı.");
        }
    }

    [ThreadStatic] static OperatorInputScope operatorInput;

    sealed class OperatorBusyException : InvalidOperationException {
        public OperatorBusyException() : base(OperatorWaitMessage) { }
    }

    sealed class OperatorInputScope : IDisposable {
        readonly uint inputTick;
        bool hasPanCafeFocus;
        public uint PanCafeProcess { private get; set; }
        public static bool IsActive { get { return operatorInput != null; } }
        public OperatorInputScope() {
            inputTick = ReadLastInputTick();
            operatorInput = this;
        }
        public void Check(IntPtr foreground, bool allowDesktop) {
            if (ReadLastInputTick() != inputTick) throw new OperatorBusyException();

            uint foregroundProcess;
            GetWindowThreadProcessId(foreground, out foregroundProcess);
            if (PanCafeProcess != 0 && foregroundProcess == PanCafeProcess) {
                hasPanCafeFocus = true;
                return;
            }
            // The desktop can hand focus to PanCafe at the start. Once PanCafe is
            // active, any switch away yields to the cashier.
            if (allowDesktop && !hasPanCafeFocus && IsDesktopForeground(foreground, foregroundProcess)) return;
            throw new OperatorBusyException();
        }
        public void Dispose() { operatorInput = null; }
    }

    static bool IsDesktopForeground(IntPtr foreground, uint foregroundProcess) {
        var shell = GetShellWindow();
        if (shell == IntPtr.Zero || foreground == IntPtr.Zero) return false;
        if (foreground == shell) return true;
        uint shellProcess;
        GetWindowThreadProcessId(shell, out shellProcess);
        return foregroundProcess == shellProcess && Class(foreground) == "WorkerW";
    }

    static uint ReadLastInputTick() {
        var input = new LastInputInfo { Size = (uint)Marshal.SizeOf(typeof(LastInputInfo)) };
        if (!GetLastInputInfo(ref input)) throw new OperatorBusyException();
        return input.Tick;
    }

    static void CheckOperatorInput() {
        if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), false);
    }

    static void WriteControlText(IntPtr root, IntPtr edit, string value, bool useCharacterInput) {
        CheckOperatorInput();
        if (!IsChild(root, edit) || !IsWindowVisible(edit) || !IsWindowEnabled(edit))
            throw new InvalidOperationException("PanCafe giriş alanı doğrulanamadı.");
        // Keep WM_CHAR for inputs whose PanCafe OnKeyPress handlers are necessary.
        if (!useCharacterInput && OperatorInputScope.IsActive && TrySetUiAutomationValue(edit, value)) return;
        IntPtr result;
        var text = new StringBuilder(useCharacterInput ? "" : value);
        if (SendText(edit, 12, IntPtr.Zero, text, 2, 2000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("PanCafe giriş alanına yazılamadı.");
        if (useCharacterInput) {
            foreach (char character in value) {
                CheckOperatorInput();
                Message(edit, 0x102, character, new IntPtr(1));
            }
        }
        CheckOperatorInput();
    }

    static void PostControlKey(IntPtr target, int key, int keyFlags, Action recordSubmission = null) {
        CheckOperatorInput();
        int state = (keyFlags << 16) | 1;
        if (recordSubmission != null) recordSubmission();
        if (!PostMessage(target, 0x100, new IntPtr(key), new IntPtr(state)))
            throw new InvalidOperationException("PanCafe kontrolüne tuş gönderilemedi.");
        PostMessage(target, 0x101, new IntPtr(key), new IntPtr(unchecked((int)0xC0000000) | state));
    }

    static void MenuClick(IntPtr h, int x, int y, bool doubleClick = false, Action recordSubmission = null) {
        CheckOperatorInput();
        var point = new IntPtr((y << 16) | (x & 65535));
        if (recordSubmission != null) recordSubmission();
        PostMessage(h, 0x200, IntPtr.Zero, point);
        if (!PostMessage(h, 0x201, new IntPtr(1), point))
            throw new InvalidOperationException("PanCafe kontrolüne tıklama gönderilemedi.");
        PostMessage(h, 0x202, IntPtr.Zero, point);
        if (doubleClick) {
            PostMessage(h, 0x203, new IntPtr(1), point);
            PostMessage(h, 0x202, IntPtr.Zero, point);
        }
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
    static void FocusControl(IntPtr root, IntPtr control) {
        if (!IsChild(root, control) || !IsWindowVisible(control) || !IsWindowEnabled(control))
            throw new InvalidOperationException("PanCafe giriş alanı doğrulanamadı.");
        Activate(root);
        uint owner;
        uint target = GetWindowThreadProcessId(control, out owner);
        uint current = GetCurrentThreadId();
        CheckOperatorInput();
        bool attached = target != current && AttachThreadInput(current, target, true);
        try {
            CheckOperatorInput();
            SetFocus(control);
            CheckOperatorInput();
            CheckFocus(control);
        } finally {
            if (attached) AttachThreadInput(current, target, false);
        }
    }
    static void TypeFocused(IntPtr root, IntPtr edit, string value) {
        FocusControl(root, edit);
        Key(17, false);
        try { PressKey(65); } finally { Key(17, true); }
        PressKey(8);
        foreach (char character in value) {
            CheckFocus(edit);
            var down = new KeyboardInput { Type=1, Scan=character, Flags=4 };
            var up = new KeyboardInput { Type=1, Scan=character, Flags=6 };
            if (SendInput(2, new[]{down,up}, Marshal.SizeOf(typeof(KeyboardInput))) != 2)
                throw new InvalidOperationException("PanCafe üye araması yapılamadı.");
            Thread.Sleep(25);
        }
    }
    static void PressKey(ushort key) { Key(key, false); Key(key, true); }
    static void RestoreWindow(IntPtr h) {
        if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), true);
        if (IsWindowVisible(h) && !IsIconic(h)) return;
        // PanCafe can hide its main form on minimize. Restore the verified form before
        // inspecting dialogs or using screen coordinates.
        const int restore = 9;
        const int showWithoutActivation = 4;
        ShowWindowAsync(h, OperatorInputScope.IsActive ? showWithoutActivation : restore);
        var timeout = Stopwatch.StartNew();
        while (!IsWindowVisible(h) || IsIconic(h)) {
            if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), true);
            if (timeout.ElapsedMilliseconds >= 2000)
                throw new NativeWindowUnavailableException("PanCafe yönetim penceresi açılamadı.");
            Thread.Sleep(50);
        }
        Thread.Sleep(120);
    }
    static void Activate(IntPtr h) {
        RestoreWindow(h);
        var foregroundWindow = GetForegroundWindow();
        if (operatorInput != null) operatorInput.Check(foregroundWindow, true);
        if (foregroundWindow == h) return;
        // The HTTP worker has no message loop. AttachThreadInput requires one.
        NativeMessage message; PeekMessage(out message,IntPtr.Zero,0,0,0);
        uint ignored;
        uint foreground = GetWindowThreadProcessId(foregroundWindow, out ignored);
        uint target = GetWindowThreadProcessId(h,out ignored);
        uint current = GetCurrentThreadId();
        bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        bool targetAttached=target!=0 && target!=current && target!=foreground && AttachThreadInput(current,target,true);
        try {
            if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), true);
            if (!SetForegroundWindow(h) && GetForegroundWindow() != h) {
                if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), true);
                BringWindowToTop(h);
                SetActiveWindow(h);
                SetForegroundWindow(h);
            }
        } finally {
            if(targetAttached)AttachThreadInput(current,target,false);
            if (attached) AttachThreadInput(current, foreground, false);
        }
        // Foreground changes to another GUI thread can finish asynchronously.
        var timeout = Stopwatch.StartNew();
        while (GetForegroundWindow() != h) {
            if (operatorInput != null) operatorInput.Check(GetForegroundWindow(), true);
            if (timeout.ElapsedMilliseconds >= 500) {
                if (OperatorInputScope.IsActive) throw new OperatorBusyException();
                throw new NativeWindowUnavailableException("PanCafe yönetim ekranı öne alınamadı.");
            }
            Thread.Sleep(30);
        }
        Thread.Sleep(120);
    }
    static void Click(IntPtr root, IntPtr target, int x, int y, bool doubleClick = false, Action recordSubmission = null) {
        Activate(root);
        Point point = new Point { X = x, Y = y }, before;
        if (!IsWindowVisible(target) || !ClientToScreen(target, ref point) || !GetCursorPos(out before))
            throw new InvalidOperationException("PanCafe kontrolüne ulaşılamadı.");
        if (OperatorInputScope.IsActive) {
            if (GetForegroundWindow() != root) throw new OperatorBusyException();
            var hit = WindowFromPoint(point);
            if (hit != target) {
                uint owner, hitOwner;
                GetWindowThreadProcessId(root, out owner);
                GetWindowThreadProcessId(hit, out hitOwner);
                if (hitOwner != owner) throw new OperatorBusyException();
                throw new InvalidOperationException("PanCafe ekranının önünde başka bir pencere var.");
            }
            MenuClick(target, x, y, doubleClick, recordSubmission);
            return;
        }
        if (!SetCursorPos(point.X, point.Y)) throw new InvalidOperationException("PanCafe kontrolü seçilemedi.");
        try {
            Thread.Sleep(60);
            if (WindowFromPoint(point) != target) throw new InvalidOperationException("PanCafe ekranının önünde başka bir pencere var.");
            mouse_event(2, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);
            mouse_event(4, 0, 0, 0, UIntPtr.Zero);
            if (doubleClick) {
                Thread.Sleep(45);
                if (WindowFromPoint(point) == target) {
                    mouse_event(2, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(30);
                    mouse_event(4, 0, 0, 0, UIntPtr.Zero);
                }
            }
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
            if ((pid == 0 || owner == pid) && (!visible || IsWindowVisible(h)) && (kind == null || Class(h) == kind)) result.Add(h);
            return true;
        }, IntPtr.Zero);
        return result;
    }
    static List<IntPtr> Children(IntPtr parent, bool visible = true) {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr h, IntPtr data) { if (!visible || IsWindowVisible(h)) result.Add(h); return true; }, IntPtr.Zero);
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
            int index = FindExact(name, 0);
            if (index < 0) throw new InvalidOperationException("Bilgisayar PanCafe ekranında bulunamadı.");
            return index;
        }
        public int UsernameColumn() {
            var header = new IntPtr(Message(list, 0x101F, 0, IntPtr.Zero));
            if (header == IntPtr.Zero) return -1;
            int count = (int)Message(header, 0x1200, 0, IntPtr.Zero);
            if (count < 0 || count > 50) return -1;
            for (int i = 0; i < count; i++) {
                var value = new byte[1024];
                Array.Copy(BitConverter.GetBytes(2), 0, value, 0, 4);
                Array.Copy(BitConverter.GetBytes(memory.ToInt32() + 64), 0, value, 8, 4);
                Array.Copy(BitConverter.GetBytes(400), 0, value, 16, 4);
                Write(value);
                if (Message(header, 0x120B, i, memory) == 0) continue;
                string text = Encoding.Unicode.GetString(Read(64, 800)).Split('\0')[0].Trim().Trim('[', ']').Trim();
                if (text == "Kullanıcı Adı" || text == "Kullanıcı adı" || text == "Üye Kullanıcı Adı") return i;
            }
            return -1;
        }
        public bool SelectNamedTab(Predicate<string> matches) {
            int count = (int)Message(list, 0x1304, 0, IntPtr.Zero);
            if (count < 1 || count > 40) return false;
            for (int i = 0; i < count; i++) {
                var value = new byte[1024];
                Array.Copy(BitConverter.GetBytes(1), 0, value, 0, 4);
                Array.Copy(BitConverter.GetBytes(memory.ToInt32() + 64), 0, value, 12, 4);
                Array.Copy(BitConverter.GetBytes(400), 0, value, 16, 4);
                Write(value);
                if (Message(list, 0x133C, i, memory) == 0 ||
                    !matches(Encoding.Unicode.GetString(Read(64, 800)).Split('\0')[0])) continue;
                if (Message(list, 0x130A, i, memory) == 0) return false;
                var bounds = Read(0, 16);
                MenuClick(list,
                    (BitConverter.ToInt32(bounds, 0) + BitConverter.ToInt32(bounds, 8)) / 2,
                    (BitConverter.ToInt32(bounds, 4) + BitConverter.ToInt32(bounds, 12)) / 2);
                return true;
            }
            return false;
        }
        public int FindExact(string name, int column) {
            int count = (int)Message(list, 0x1004, 0, IntPtr.Zero), index = -1;
            if (count < 0 || count > 50000) throw new InvalidOperationException("PanCafe liste boyutu geçersiz.");
            if (column == 0 && name.Length < 400) {
                var search = new byte[1024];
                Array.Copy(BitConverter.GetBytes(2), 0, search, 0, 4);
                Array.Copy(BitConverter.GetBytes(memory.ToInt32() + 64), 0, search, 4, 4);
                var literal = Encoding.Unicode.GetBytes(name);
                Array.Copy(literal, 0, search, 64, literal.Length);
                Write(search);
                int found = (int)Message(list, 0x1053, -1, memory);
                if (found >= 0 && found < count && RowText(found, column) == name) {
                    Write(search);
                    int next = (int)Message(list, 0x1053, found, memory);
                    if (next > found && next < count && RowText(next, column) == name)
                        throw new InvalidOperationException("PanCafe listesinde birden fazla eşleşme bulundu.");
                    return found;
                }
            }
            for (int i = 0; i < count; i++) {
                if (RowText(i, column) != name) continue;
                if (index >= 0) throw new InvalidOperationException("PanCafe listesinde birden fazla eşleşme bulundu.");
                index = i;
            }
            return index;
        }
        string RowText(int row, int column) {
            var value = new byte[1024];
            Array.Copy(BitConverter.GetBytes(column), 0, value, 8, 4);
            Array.Copy(BitConverter.GetBytes(memory.ToInt32() + 64), 0, value, 20, 4);
            Array.Copy(BitConverter.GetBytes(400), 0, value, 24, 4);
            Write(value); Message(list, 0x1073, row, memory);
            return Encoding.Unicode.GetString(Read(64, 800)).Split('\0')[0];
        }
        public void Select(int index) {
            ClearSelection();
            var value = new byte[64];
            Array.Copy(BitConverter.GetBytes(3), 0, value, 16, 4);
            Array.Copy(BitConverter.GetBytes(3), 0, value, 12, 4);
            Write(value); Message(list, 0x102B, index, memory);
            Message(list, 0x1013, index, IntPtr.Zero); // LVM_ENSUREVISIBLE
        }
        public void ClearSelection() {
            var value = new byte[64];
            Array.Copy(BitConverter.GetBytes(3), 0, value, 16, 4);
            Write(value); Message(list, 0x102B, -1, memory);
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
    [StructLayout(LayoutKind.Sequential)]
    struct LastInputInfo { public uint Size, Tick; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInputInfo info);
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
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
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
