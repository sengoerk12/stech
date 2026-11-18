using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public static partial class PanCafeNativeSessions {
    public static List<Dictionary<string,string>> Credit(string database, string client, string folder,
        int memberId, string username, long amount, long bonus, string operationId, bool retryUnconfirmed = false) {
        Guid operation = PanCafeBalanceWriter.Validate(memberId, username, amount, bonus, operationId);
        string id = operation.ToString();
        string marker = "STechPOS-" + operation.ToString("N");
        long total = amount + bonus;
        using (var mutex = new Mutex(false, "Local\\STech-PanCafe-NativeSessions")) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return Result("active", "PanCafe işlem sırası bekleniyor.");
            try {
                var arguments = new[] { id, Invariant(memberId), username, Invariant(amount), Invariant(bonus) };
                var receipt = ReadCompletedCredit(database, client, arguments);
                if (receipt.Count == 1) return receipt;
                var pending = PanCafeReadOnly.Query(database, client,
                    "SELECT MEMBERID,USERNAME,AMOUNT,BONUS,CREDIT_TOTAL FROM STECH_LIVE_CREDIT_INTENTS WHERE OPID='" + id + "'");
                if (pending.Count != 0) {
                    AssertCreditIdentity(pending[0], arguments);
                    bool legacy = pending[0]["CREDIT_TOTAL"] == null;
                    if (!legacy && pending[0]["CREDIT_TOTAL"] != Invariant(total))
                        throw new InvalidOperationException("Credit total conflict");
                    var previous = ConfirmLiveCredit(database, client, arguments, marker, amount, total, legacy);
                    if (previous[0]["RESULT_CODE"] == "ok" || !retryUnconfirmed ||
                        !CanRetryUnconfirmedCredit(database, client, id, marker)) return previous;
                }

                var member = PanCafeReadOnly.Query(database, client,
                    "SELECT ID FROM MEMBERS WHERE ACCSTATUS=1 AND ID=" + arguments[1] + " AND USERNAME='" + username + "'");
                if (member.Count != 1) throw new InvalidOperationException("Credit member mismatch");
                NativeUi ui = null;
                try {
                    if (!PanCafeBalanceWriter.AutoMemberBonusDisabled(database, client))
                        throw new InvalidOperationException("PanCafe otomatik üye bonusu kapatılmalı.");
                    ui = new NativeUi(database);
                    ui.PrepareCredit(username, marker, total, pending.Count != 0);
                } catch (Exception error) {
                    File.WriteAllText(Path.Combine(folder, "credit-readiness-error.json"),
                        new JavaScriptSerializer().Serialize(new { operationId=id, message=error.Message,
                            navigation=ui == null ? null : ui.CreditNavigation,
                            screenLabels=ui == null ? null : ui.CreditScreenLabels,
                            visibleWindows=ui == null ? null : ui.VisibleWindowTypes(),
                            controlTypes=ui == null ? null : ui.CreditControlTypes(), at=DateTime.UtcNow.ToString("o") }));
                    if (ui != null) ui.CloseLiveCredit();
                    return Result("credit_ui_review", error is InvalidOperationException ? error.Message : "PanCafe yükleme ekranı hazır değil.");
                }

                bool submitted = false;
                try {
                    if (!PanCafeBalanceWriter.AutoMemberBonusDisabled(database, client))
                        return Result("credit_ui_review", "PanCafe otomatik üye bonusu kapatılmalı.");
                    if (pending.Count != 0) {
                        // The cashier could have completed the previous attempt while the new dialog was opening.
                        if (!CanRetryUnconfirmedCredit(database, client, id, marker))
                            return ConfirmLiveCredit(database, client, arguments, marker, amount, total, pending[0]["CREDIT_TOTAL"] == null);
                        PanCafeReadOnly.Write(database, client,
                            "UPDATE STECH_LIVE_CREDIT_INTENTS SET CREDIT_TOTAL=?,CREATED_AT=CURRENT_TIMESTAMP WHERE OPID=?",
                            new[] { Invariant(total), id });
                    } else {
                        PanCafeReadOnly.Write(database, client,
                            "INSERT INTO STECH_LIVE_CREDIT_INTENTS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,CREDIT_TOTAL) VALUES(?,?,?,?,?,?)",
                            new[] { id, Invariant(memberId), username, Invariant(amount), Invariant(bonus), Invariant(total) });
                    }
                    ui.VerifyLiveCredit(username, marker, total);
                    submitted = true;
                    ui.SubmitLiveCredit();
                    return ConfirmLiveCredit(database, client, arguments, marker, amount, total, false);
                } finally { if (!submitted) ui.CloseLiveCredit(); }
            } finally { mutex.ReleaseMutex(); }
        }
    }

    static string Invariant(long value) { return value.ToString(CultureInfo.InvariantCulture); }

    internal static bool CanRetryUnconfirmedCredit(string database, string client, string id, string marker) {
        // PanCafe records its own balance credits in MEMBERSHISTORY. Allow an operator-initiated
        // retry only after the confirmation has settled and no matching or unlabelled credit is present.
        var rows = PanCafeReadOnly.Query(database, client,
            "SELECT FIRST 1 I.OPID FROM STECH_LIVE_CREDIT_INTENTS I WHERE I.OPID='" + id + "'" +
            " AND I.CREATED_AT<=DATEADD(-15 SECOND TO CURRENT_TIMESTAMP)" +
            " AND NOT EXISTS (SELECT 1 FROM MEMBERSHISTORY H WHERE H.NOTE CONTAINING '" + marker + "'" +
            " OR (H.MEMBERS_USERNAME=I.USERNAME AND (H.MIKTAR>0 OR H.NOTE CONTAINING 'para yüklendi')" +
            " AND (CAST(H.TARIH AS DATE)>CAST(DATEADD(-5 SECOND TO I.CREATED_AT) AS DATE)" +
            " OR (CAST(H.TARIH AS DATE)=CAST(DATEADD(-5 SECOND TO I.CREATED_AT) AS DATE)" +
            " AND COALESCE(H.SAAT,CAST('23:59:59' AS TIME))>=CAST(DATEADD(-5 SECOND TO I.CREATED_AT) AS TIME)))))");
        return rows.Count == 1;
    }

    static void AssertCreditIdentity(Dictionary<string,string> prior, string[] arguments) {
        if (prior["MEMBERID"] != arguments[1] || prior["USERNAME"] != arguments[2] ||
            prior["AMOUNT"] != arguments[3] || prior["BONUS"] != arguments[4])
            throw new InvalidOperationException("Credit identity or operation conflict");
    }

    static List<Dictionary<string,string>> ReadCompletedCredit(string database, string client, string[] arguments) {
        var receipt = PanCafeReadOnly.Query(database, client,
            "SELECT 'ok' AS RESULT_CODE,MEMBERID,USERNAME,AMOUNT,BONUS,CAST(BALANCEAFTER AS DECIMAL(18,2)) AS BALANCE_TL" +
            " FROM STECH_MOBILE_CREDITS WHERE OPID='" + arguments[0] + "'");
        if (receipt.Count == 1) {
            AssertCreditIdentity(receipt[0], arguments);
            receipt[0] = new Dictionary<string,string> { { "RESULT_CODE", "ok" }, { "BALANCE_TL", receipt[0]["BALANCE_TL"] } };
        }
        return receipt;
    }

    static List<Dictionary<string,string>> ConfirmLiveCredit(string database, string client, string[] arguments,
        string marker, long amount, long total, bool legacy) {
        string id = arguments[0];
        var rows = PanCafeReadOnly.Query(database, client,
            "SELECT FIRST 2 CAST(H.MIKTAR AS DECIMAL(18,2)) AS AMOUNT_TL,CAST(H.KALAN AS DECIMAL(18,2)) AS BALANCE_TL" +
            " FROM MEMBERSHISTORY H JOIN MEMBERS M ON M.USERNAME=H.MEMBERS_USERNAME WHERE M.ID=" + arguments[1] +
            " AND M.USERNAME='" + arguments[2] + "' AND H.TARIH>=M.RECDATE AND H.NOTE CONTAINING '" + marker + "'");
        long recorded;
        if (rows.Count != 1 || !TryKurus(rows[0]["AMOUNT_TL"], out recorded) ||
            (recorded != total && (!legacy || recorded != amount)))
            return Result("credit_review", "PanCafe yükleme kaydı doğrulanıyor.");
        var row = rows[0];
        PanCafeReadOnly.Write(database, client,
            "INSERT INTO STECH_MOBILE_CREDITS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,BALANCEAFTER) VALUES(?,?,?,?,?,?)",
            new[] { arguments[0], arguments[1], arguments[2], arguments[3], arguments[4], row["BALANCE_TL"] });
        return new List<Dictionary<string,string>> { new Dictionary<string,string> {
            {"RESULT_CODE","ok"}, {"BALANCE_TL",row["BALANCE_TL"]}
        }};
    }

    static bool TryKurus(string value, out long amount) {
        amount = 0;
        if (value == null) return false;
        // The current PanCafe version shows Turkish decimals. Its database returns a dot.
        string normalized = value.Trim().Replace("₺", "").Trim();
        if (Regex.IsMatch(normalized, @"\A[0-9]{1,3}(\.[0-9]{3})+(,[0-9]{1,2})?\z"))
            normalized = normalized.Replace(".", "");
        if (!Regex.IsMatch(normalized, @"\A[0-9]+([,.][0-9]{1,2})?\z")) return false;
        decimal parsed;
        if (!Decimal.TryParse(normalized.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out parsed)
            || parsed > 100000000) return false;
        amount = (long)(parsed * 100);
        return true;
    }

    sealed partial class NativeUi {
        IntPtr creditDialog, creditAmount, creditNote, creditPayment, creditAdd, creditSubtract, creditConfirm;
        Rectangle creditConfirmLabel;
        bool creditMenuOpened;
        bool closeCreditDialog;
        bool creditForeground;

        public void PrepareCredit(string username, string marker, long amount, bool reusePrevious) {
            var opened = FindNativeCreditWindow(username);
            if (!opened) {
                CheckIdle();
                OpenMemberCredit(username);
            }
            for (int retry = 0; !opened && retry < 20; retry++) {
                if (FindNativeCreditWindow(username)) {
                    closeCreditDialog = true;
                    break;
                }
                var dialog = GetForegroundWindow();
                if (dialog == main || dialog == creditOwner) dialog = CreditPopup();
                if (dialog != main && dialog != creditOwner && IsCreditDialog(dialog, username)) {
                    creditDialog = dialog;
                    closeCreditDialog = true;
                    break;
                }
                if (picker == IntPtr.Zero &&
                    Class(dialog) == "TSrvMemberSearchDlgFrm" && IsWindowVisible(dialog)) {
                    uint owner;
                    GetWindowThreadProcessId(dialog, out owner);
                    if (owner != processId) throw new InvalidOperationException("PanCafe üye arama penceresi doğrulanamadı.");
                    picker = dialog;
                    PrepareMemberSearch(username);
                    Accept(username);
                }
                Thread.Sleep(100);
            }
            if (creditDialog == IntPtr.Zero)
                throw new InvalidOperationException("Üye Bakiyesi Düzenle penceresi doğrulanamadı.");
            CreditNavigation = "credit-dialog";
            creditForeground = GetForegroundWindow() == creditDialog;
            if (!creditForeground) {
                try { Activate(creditDialog); creditForeground = true; }
                catch (InvalidOperationException) { /* Native window messages can still reach the verified dialog. */ }
            }

            var controls = Children(creditDialog);
            creditPayment = ExactlyOne(controls.FindAll(h => Class(h).Contains("ComboBox") && IsCash(h)), "Nakit");
            creditAdd = OptionalNamedControl(controls, "Radio", "Ekle");
            creditSubtract = OptionalNamedControl(controls, "Radio", "Çıkar");
            creditConfirm = OptionalNamedControl(controls, "Button", "Tamam");
            var payment = BoundsOf(creditPayment);
            var edits = controls.FindAll(h => Class(h).EndsWith("Edit", StringComparison.Ordinal));
            creditAmount = ExactlyOne(edits.FindAll(h => AlignedEdit(BoundsOf(h), payment, true)), "Miktar");
            creditNote = ExactlyOne(edits.FindAll(h => AlignedEdit(BoundsOf(h), payment, false)), "Açıklama");

            if (opened && !closeCreditDialog) {
                long initialAmount;
                string initial = Text(creditAmount);
                string note = Text(creditNote);
                bool sameAttempt = reusePrevious && note == marker && TryKurus(initial, out initialAmount) && initialAmount == amount;
                if (!sameAttempt && (!String.IsNullOrWhiteSpace(note) ||
                    (!String.IsNullOrWhiteSpace(initial) && (!TryKurus(initial, out initialAmount) || initialAmount != 0))))
                    throw new InvalidOperationException("PanCafe’de kasiyerin açık bakiye işlemi var.");
                closeCreditDialog = true;
            }
            if (creditAdd != IntPtr.Zero) {
                var add = ClientBounds(creditAdd);
                if (creditForeground) Click(creditDialog, creditAdd, add.Right / 2, add.Bottom / 2);
                else MenuClick(creditAdd, add.Right / 2, add.Bottom / 2);
            } else {
                var add = FindScreenText(CreditChoices(creditDialog, creditPayment), "Ekle");
                if (add.IsEmpty || !ClickScreenText(creditDialog, creditDialog, add))
                    throw new InvalidOperationException("PanCafe Ekle düğmesi doğrulanamadı.");
            }
            var amountText = (amount / 100m).ToString(amount % 100 == 0 ? "0" : "0.00", CultureInfo.GetCultureInfo("tr-TR"));
            if (creditForeground) {
                TypeFocused(creditDialog, creditAmount, amountText);
                TypeFocused(creditDialog, creditNote, marker);
            } else {
                SetText(creditAmount, "");
                foreach (var character in amountText) Message(creditAmount, 0x102, character, new IntPtr(1));
                SetText(creditNote, marker);
            }
            if (creditConfirm == IntPtr.Zero) {
                var box = AsRectangle(BoundsOf(creditDialog));
                int top = box.Top + box.Height * 3 / 4;
                creditConfirmLabel = FindScreenText(Rectangle.FromLTRB(box.Left, top, box.Right, box.Bottom), "Tamam");
            }
            VerifyLiveCredit(username, marker, amount);
        }

        public void VerifyLiveCredit(string username, string marker, long amount) {
            long visibleAmount;
            if (!CreditDialogIsCurrent() || !IsCreditDialog(creditDialog, username))
                throw new InvalidOperationException("PanCafe yükleme penceresindeki üye değişti.");
            if (!TryKurus(Text(creditAmount), out visibleAmount) || visibleAmount != amount)
                throw new InvalidOperationException("PanCafe yükleme tutarı doğrulanamadı.");
            if (Text(creditNote) != marker)
                throw new InvalidOperationException("PanCafe yükleme açıklaması doğrulanamadı.");
            if (!IsCash(creditPayment))
                throw new InvalidOperationException("PanCafe Nakit ödeme şekli doğrulanamadı.");
            if (creditConfirm == IntPtr.Zero ? creditConfirmLabel.IsEmpty : !IsWindowEnabled(creditConfirm))
                throw new InvalidOperationException("PanCafe Tamam düğmesi doğrulanamadı.");
            if (!(creditAdd != IntPtr.Zero && IsChecked(creditAdd)) &&
                !ReadCreditChoice(CreditChoices(creditDialog, creditPayment), creditAdd, creditSubtract))
                throw new InvalidOperationException("PanCafe Ekle seçimi doğrulanamadı.");
        }

        public void SubmitLiveCredit() {
            if (!CreditDialogIsCurrent())
                throw new InvalidOperationException("PanCafe yükleme penceresi değişti.");
            if (creditConfirm == IntPtr.Zero) {
                if (creditConfirmLabel.IsEmpty || !ClickScreenText(creditDialog, creditDialog, creditConfirmLabel))
                    throw new InvalidOperationException("PanCafe Tamam düğmesi doğrulanamadı.");
                return;
            }
            if (!IsWindowVisible(creditConfirm) || !IsWindowEnabled(creditConfirm))
                throw new InvalidOperationException("PanCafe Tamam düğmesi değişti.");
            var button = ClientBounds(creditConfirm);
            if (creditForeground) Click(creditDialog, creditConfirm, button.Right / 2, button.Bottom / 2);
            else MenuClick(creditConfirm, button.Right / 2, button.Bottom / 2);
        }

        public void CloseLiveCredit() {
            if (closeCreditDialog && creditDialog != IntPtr.Zero && IsWindowVisible(creditDialog))
                PostMessage(creditDialog, 0x10, IntPtr.Zero, IntPtr.Zero);
            if (creditMenuOpened) PostMessage(main, 0x1F, IntPtr.Zero, IntPtr.Zero);
            if (picker != IntPtr.Zero && IsWindowVisible(picker))
                PostMessage(picker, 0x10, IntPtr.Zero, IntPtr.Zero);
        }

        bool IsCreditDialog(IntPtr dialog, string username) {
            if (dialog == IntPtr.Zero) return false;
            uint owner;
            GetWindowThreadProcessId(dialog, out owner);
            if (owner != processId || !IsWindowVisible(dialog)) return false;
            if (Regex.IsMatch(Caption(dialog), @"\AÜye Bakiyesi Düzenle\s*\[\s*" +
                Regex.Escape(username) + @"\s*\]\s*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return true;
            var box = AsRectangle(BoundsOf(dialog));
            if (box.Width < 300 || box.Height < 220 || box.Width > 1600 || box.Height > 1200) return false;
            var title = new Rectangle(box.Left, box.Top, Math.Min(630, box.Width), Math.Min(53, box.Height));
            var words = GetForegroundWindow() == dialog
                ? ReadScreenWords(title) : ReadNativeWindowTitle(dialog, box, title.Size);
            if (PanCafeScreenText.FindUnique(words, "Üye Bakiyesi Düzenle").IsEmpty &&
                PanCafeScreenText.FindUnique(words, "Üye Bakiyesi DüzenIe").IsEmpty) return false;
            if (words.Exists(word => word.Text.Trim('[', ']').Equals(username, StringComparison.OrdinalIgnoreCase))) return true;
            var line = new StringBuilder();
            foreach (var word in words) {
                if (word.Text.Length != 0) { line.Append(word.Text); continue; }
                if (line.ToString().IndexOf("[" + username + "]", StringComparison.OrdinalIgnoreCase) >= 0) return true;
                line.Clear();
            }
            return false;
        }
        static List<PanCafeScreenText.Match> ReadNativeWindowTitle(IntPtr window, Rectangle full, Size title) {
            using (var picture = new Bitmap(full.Width, full.Height)) {
                using (var graphics = Graphics.FromImage(picture)) {
                    var device = graphics.GetHdc();
                    try {
                        if (!PrintWindow(window, device, 2)) return new List<PanCafeScreenText.Match>();
                    } finally { graphics.ReleaseHdc(device); }
                }
                using (var header = picture.Clone(new Rectangle(System.Drawing.Point.Empty, title), picture.PixelFormat))
                    return PanCafeScreenText.Read(header);
            }
        }
        Bitmap CaptureCreditRegion(Rectangle area) {
            if (area.Width < 5 || area.Height < 5)
                throw new InvalidOperationException("PanCafe yükleme alanı okunamadı.");
            if (GetForegroundWindow() == creditDialog) {
                var picture = new Bitmap(area.Width, area.Height);
                try {
                    using (var graphics = Graphics.FromImage(picture))
                        graphics.CopyFromScreen(area.Location, System.Drawing.Point.Empty, area.Size);
                    return picture;
                } catch { picture.Dispose(); throw; }
            }
            var box = AsRectangle(BoundsOf(creditDialog));
            if (!box.Contains(area))
                throw new InvalidOperationException("PanCafe yükleme alanı pencerenin dışında.");
            using (var full = new Bitmap(box.Width, box.Height)) {
                using (var graphics = Graphics.FromImage(full)) {
                    var device = graphics.GetHdc();
                    try {
                        if (!PrintWindow(creditDialog, device, 2))
                            throw new InvalidOperationException("PanCafe yükleme penceresi okunamadı.");
                    } finally { graphics.ReleaseHdc(device); }
                }
                area.Offset(-box.Left, -box.Top);
                return full.Clone(area, full.PixelFormat);
            }
        }
        bool FindNativeCreditWindow(string username) {
            var windows = Windows("TSrvMemberKrediYukleFrm", processId, true);
            if (windows.Count == 0) return false;
            if (windows.Count != 1)
                throw new InvalidOperationException("PanCafe’de birden fazla bakiye penceresi açık.");
            var window = windows[0];
            if (!IsCreditDialog(window, username) && GetForegroundWindow() != window) {
                try { Activate(window); } catch (InvalidOperationException) { }
            }
            if (!IsCreditDialog(window, username))
                throw new InvalidOperationException("PanCafe bakiye penceresindeki üye doğrulanamadı.");
            creditDialog = window;
            return true;
        }
        bool CreditDialogIsCurrent() {
            if (creditDialog == IntPtr.Zero || !IsWindowVisible(creditDialog)) return false;
            if (GetForegroundWindow() == creditDialog || CreditPopup() == creditDialog) return true;
            var windows = Windows("TSrvMemberKrediYukleFrm", processId, true);
            return windows.Count == 1 && windows[0] == creditDialog;
        }
        public string[] VisibleWindowTypes() {
            var types = new HashSet<string>();
            foreach (var window in Windows(null, processId, true)) {
                if (window != main) types.Add(Class(window));
            }
            var result = new string[types.Count];
            types.CopyTo(result);
            return result;
        }
        static bool IsCash(IntPtr control) {
            return Caption(control) == "Nakit" || Text(control) == "Nakit" ||
                !FindScreenText(AsRectangle(BoundsOf(control)), "Nakit").IsEmpty;
        }
        static Rectangle CreditChoices(IntPtr dialog, IntPtr payment) {
            var box = BoundsOf(dialog);
            var field = BoundsOf(payment);
            int line = field.Bottom - field.Top;
            return Rectangle.FromLTRB(field.Right, Math.Max(box.Top, field.Top - line * 2), box.Right,
                Math.Min(box.Bottom, field.Bottom + line * 2));
        }
        bool ReadCreditChoice(Rectangle area, IntPtr add, IntPtr subtract) {
            using (var picture = CaptureCreditRegion(area)) {
                if (add == IntPtr.Zero || subtract == IntPtr.Zero) return PanCafeScreenText.IsAddSelected(picture);
                var a = AsRectangle(BoundsOf(add));
                var b = AsRectangle(BoundsOf(subtract));
                a.Offset(-area.Left, -area.Top);
                b.Offset(-area.Left, -area.Top);
                return PanCafeScreenText.IsAddSelectedInControls(picture, a, b);
            }
        }
        static IntPtr OptionalNamedControl(List<IntPtr> controls, string kind, string caption) {
            var matches = controls.FindAll(h => Class(h).Contains(kind) && (Caption(h) == caption || Text(h) == caption));
            return matches.Count == 1 ? matches[0] : IntPtr.Zero;
        }
        static IntPtr ExactlyOne(List<IntPtr> controls, string name) {
            if (controls.Count != 1) throw new InvalidOperationException("PanCafe yükleme alanı doğrulanamadı: " + name);
            return controls[0];
        }
        static Rect BoundsOf(IntPtr control) {
            Rect result;
            if (!GetWindowRect(control, out result)) throw new InvalidOperationException("PanCafe yükleme alanı okunamadı.");
            return result;
        }
        static Rect ClientBounds(IntPtr control) {
            Rect result;
            if (!GetClientRect(control, out result)) throw new InvalidOperationException("PanCafe yükleme düğmesi okunamadı.");
            return result;
        }
        static bool AlignedEdit(Rect field, Rect payment, bool above) {
            int height = payment.Bottom - payment.Top;
            int distance = above ? payment.Top - field.Top : field.Top - payment.Top;
            int width = payment.Right - payment.Left;
            return height > 0 && Math.Abs(field.Left - payment.Left) <= height / 3 &&
                distance > 0 && distance < height * 2 &&
                (above ? field.Right - field.Left < width * 3 / 2 : field.Right - field.Left > width * 3 / 2);
        }
        static void SetText(IntPtr control, string value) {
            IntPtr ignored;
            if (SendText(control, 12, IntPtr.Zero, new StringBuilder(value), 2, 2000, out ignored) == IntPtr.Zero)
                throw new InvalidOperationException("PanCafe yükleme alanına metin yazılamadı.");
        }
    }

    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect value);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr device, uint flags);
}
