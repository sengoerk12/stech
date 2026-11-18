using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public static partial class PanCafeNativeSessions {
    const string TicketCreditTable = "STECH_TICKET_CREDITS";

    public static void InitializeTickets(string database, string client) {
        if (PanCafeReadOnly.Query(database, client,
            "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='" + TicketCreditTable + "'").Count == 0)
            PanCafeReadOnly.Write(database, client, "CREATE TABLE STECH_TICKET_CREDITS (" +
                "TICKET_ID INTEGER NOT NULL PRIMARY KEY, MEMBER_ID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL," +
                "AMOUNT BIGINT NOT NULL, SALE_AFTER BIGINT NOT NULL, BALANCE_AFTER DECIMAL(18,2))", null);
        if (PanCafeReadOnly.Query(database, client,
            "SELECT RDB$EXCEPTION_NAME FROM RDB$EXCEPTIONS WHERE RDB$EXCEPTION_NAME='STECH_TICKET_CONFLICT'").Count == 0)
            PanCafeReadOnly.Write(database, client, "CREATE EXCEPTION STECH_TICKET_CONFLICT 'S TECH ticket state changed'", null);
    }

    public static List<Dictionary<string,string>> RedeemTicket(string database, string client, int memberId, string username,
        string barcode, string diagnosticFolder = null) {
        if (memberId < 1 || !Regex.IsMatch(username ?? "", @"\A[a-zA-Z0-9_.]{1,32}\z") ||
            !Regex.IsMatch(barcode ?? "", @"\A[0-9]{10}\z"))
            throw new ArgumentException("Invalid ticket request");

        using (var mutex = new Mutex(false, "Local\\STech-PanCafe-NativeSessions")) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return Result("pending", "PanCafe meşgul. Aynı bileti tekrar okut.");
            try {
                var matches = PanCafeReadOnly.Query(database, client,
                    "SELECT FIRST 2 ID,SOLD,USED,MEMBERCREDIT,CAST(PRICE AS DECIMAL(18,2)) AS PRICE_TL," +
                    "CASE WHEN EXPDATE IS NULL OR EXPDATE>=CURRENT_DATE THEN 1 ELSE 0 END AS VALID_DATE" +
                    " FROM TICKETS WHERE BARCODE='" + barcode + "'");
                long amount;
                if (matches.Count != 1 || matches[0]["MEMBERCREDIT"] != "1" ||
                    !TryKurus(matches[0]["PRICE_TL"], out amount) || amount <= 0)
                    return TicketUnavailable();

                var ticket = matches[0];
                int ticketId = Int32.Parse(ticket["ID"], CultureInfo.InvariantCulture);
                var args = new[] { Invariant(ticketId), Invariant(memberId), username, Invariant(amount) };
                var claims = PanCafeReadOnly.Query(database, client,
                    "SELECT MEMBER_ID,USERNAME,AMOUNT,BALANCE_AFTER FROM STECH_TICKET_CREDITS WHERE TICKET_ID=" + args[0]);
                bool claimed = claims.Count == 1;
                if (claimed) {
                    var claim = claims[0];
                    if (claim["MEMBER_ID"] != args[1] || claim["USERNAME"] != username || claim["AMOUNT"] != args[3])
                        return TicketUnavailable();
                    if (claim["BALANCE_AFTER"] != null)
                        return Result("already_credited", "Bu bilet daha önce hesabına yüklendi.");
                    if (ticket["SOLD"] == "1") {
                        var resumed = ApplyTicketSale(database, client, args);
                        return resumed[0]["RESULT_CODE"] == "awaiting_sale" ? TicketPending() : resumed;
                    }
                }
                if (ticket["SOLD"] != "0" || ticket["USED"] != "0" || ticket["VALID_DATE"] != "1")
                    return TicketUnavailable();

                var account = PanCafeReadOnly.Query(database, client,
                    "SELECT ID FROM MEMBERS WHERE ID=" + args[1] + " AND USERNAME='" + username + "' AND ACCSTATUS=1");
                if (account.Count != 1) return TicketUnavailable();
                if (PanCafeReadOnly.Query(database, client,
                    "SELECT FIRST 1 ID FROM TERMINALS WHERE MEMBERID=" + args[1] + " AND TERMINALSTATUS=5").Count != 0)
                    return TicketActiveSession();

                NativeUi ui = null;
                string stage = "main-window";
                try {
                    ui = new NativeUi(database);
                    stage = "sale-window";
                    ui.OpenTicketSale();
                    stage = "barcode-input";
                    ui.EnterTicketBarcode(barcode);
                    stage = "record-intent";
                    if (!claimed) {
                        string lastSale = PanCafeReadOnly.Query(database, client,
                            "SELECT COALESCE(MAX(ID),0) AS LAST_ID FROM KASAHAR")[0]["LAST_ID"];
                        PanCafeReadOnly.Write(database, client,
                            "INSERT INTO STECH_TICKET_CREDITS(TICKET_ID,MEMBER_ID,USERNAME,AMOUNT,SALE_AFTER)" +
                            " VALUES(?,?,?,?,?)", new[]{ args[0], args[1], args[2], args[3], lastSale });
                    }
                    stage = "confirm-sale";
                    ui.SubmitTicketSale(barcode);
                    stage = "verify-sale";
                    for (int attempt = 0; attempt < 15; attempt++) {
                        var result = ApplyTicketSale(database, client, args);
                        if (result[0]["RESULT_CODE"] != "awaiting_sale") return result;
                        Thread.Sleep(200);
                    }
                    WriteTicketDiagnostic(diagnosticFolder, stage, "No matching PanCafe sale was recorded.", ui);
                    return TicketPending();
                } catch (InvalidOperationException error) {
                    WriteTicketDiagnostic(diagnosticFolder, stage, error.Message, ui);
                    string message = stage == "record-intent" || stage == "verify-sale"
                        ? "PanCafe bilet kaydını doğrulayamadı."
                        : error.Message;
                    return Result("pending", message + " Aynı bileti tekrar okut.");
                } finally {
                    if (ui != null) ui.CloseTicketSale();
                }
            } finally { mutex.ReleaseMutex(); }
        }
    }

    static void WriteTicketDiagnostic(string folder, string stage, string message, NativeUi ui) {
        if (folder == null) return;
        try {
            File.WriteAllText(Path.Combine(folder, "ticket-readiness-error.json"), new JavaScriptSerializer().Serialize(new {
                stage, message, windowTypes = ui == null ? null : ui.VisibleWindowTypes(),
                at = DateTime.UtcNow.ToString("o")
            }));
        } catch (IOException) { /* A failed diagnostic must not change the ticket result. */ }
        catch (UnauthorizedAccessException) { }
    }

    static List<Dictionary<string,string>> TicketUnavailable() {
        return Result("unavailable", "Bilet bulunamadı, kullanılmış veya bu işlem için geçerli değil.");
    }

    static List<Dictionary<string,string>> TicketActiveSession() {
        return Result("active", "Bilgisayardaki oyun oturumunu kapattıktan sonra aynı bileti tekrar okut.");
    }

    static List<Dictionary<string,string>> TicketPending() {
        return Result("pending", "PanCafe bilet satışını henüz doğrulamadı. Aynı bileti tekrar okut.");
    }

    internal static List<Dictionary<string,string>> ApplyTicketSale(string database, string client, string[] args) {
        // Tie native sale to this ticket and intended member, then consume the ticket and credit the account atomically.
        // The sale dialog already records the cash entry, so the transfer only adds a member-history entry.
        const string sql = @"EXECUTE BLOCK(P_TICKET INTEGER=?,P_MEMBER INTEGER=?,P_USER VARCHAR(32)=?,P_AMOUNT BIGINT=?)
RETURNS (RESULT_CODE VARCHAR(20), AMOUNT_KURUS BIGINT, BALANCE_TL DECIMAL(18,2)) AS
DECLARE SALE_AFTER BIGINT;
DECLARE SALES INTEGER;
DECLARE N INTEGER;
BEGIN
  RESULT_CODE='unavailable';
  SELECT COUNT(*) FROM STECH_TICKET_CREDITS WHERE TICKET_ID=:P_TICKET AND MEMBER_ID=:P_MEMBER AND USERNAME=:P_USER AND AMOUNT=:P_AMOUNT INTO :N;
  IF(N<>1) THEN BEGIN SUSPEND; EXIT; END
  SELECT BALANCE_AFTER,SALE_AFTER FROM STECH_TICKET_CREDITS WHERE TICKET_ID=:P_TICKET INTO :BALANCE_TL,:SALE_AFTER;
  IF(BALANCE_TL IS NOT NULL) THEN BEGIN RESULT_CODE='ok'; AMOUNT_KURUS=P_AMOUNT; SUSPEND; EXIT; END
  SELECT COUNT(*) FROM TICKETS WHERE ID=:P_TICKET AND MEMBERCREDIT=1 AND SOLD=1 AND USED=0
    AND CAST(PRICE AS DECIMAL(18,2))=:P_AMOUNT/CAST(100 AS DECIMAL(18,2)) INTO :N;
  IF(N<>1) THEN BEGIN
    SELECT COUNT(*) FROM TICKETS WHERE ID=:P_TICKET AND USED=0 AND SOLD=0 INTO :N;
    IF(N=1) THEN RESULT_CODE='awaiting_sale';
    SUSPEND; EXIT;
  END
  SELECT COUNT(*) FROM KASAHAR WHERE ID>:SALE_AFTER AND ISLEM=8 AND GELIRGIDER=0
    AND NOTE='Bilet No:'||CAST(:P_TICKET AS VARCHAR(12))
    AND CAST(PRICE AS DECIMAL(18,2))=:P_AMOUNT/CAST(100 AS DECIMAL(18,2)) INTO :SALES;
  IF(SALES<>1) THEN BEGIN RESULT_CODE='awaiting_sale'; SUSPEND; EXIT; END
  SELECT COUNT(*) FROM TERMINALS WHERE MEMBERID=:P_MEMBER AND TERMINALSTATUS=5 INTO :N;
  IF(N>0) THEN BEGIN RESULT_CODE='active'; SUSPEND; EXIT; END
  UPDATE TICKETS SET USED=1 WHERE ID=:P_TICKET AND SOLD=1 AND USED=0 AND MEMBERCREDIT=1
    AND CAST(PRICE AS DECIMAL(18,2))=:P_AMOUNT/CAST(100 AS DECIMAL(18,2));
  IF(ROW_COUNT<>1) THEN BEGIN SUSPEND; EXIT; END
  UPDATE MEMBERS SET BAKIYE=CAST(COALESCE(BAKIYE,0) AS DECIMAL(18,2))+:P_AMOUNT/CAST(100 AS DECIMAL(18,2))
    WHERE ID=:P_MEMBER AND USERNAME=:P_USER AND ACCSTATUS=1
    AND NOT EXISTS(SELECT 1 FROM TERMINALS WHERE MEMBERID=:P_MEMBER AND TERMINALSTATUS=5)
    RETURNING CAST(BAKIYE AS DECIMAL(18,2)) INTO :BALANCE_TL;
  IF(ROW_COUNT<>1 OR BALANCE_TL IS NULL) THEN EXCEPTION STECH_TICKET_CONFLICT;
  UPDATE STECH_TICKET_CREDITS SET BALANCE_AFTER=:BALANCE_TL WHERE TICKET_ID=:P_TICKET AND BALANCE_AFTER IS NULL;
  IF(ROW_COUNT<>1) THEN EXCEPTION STECH_TICKET_CONFLICT;
  INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE)
    VALUES(:P_USER,'',:P_AMOUNT/CAST(100 AS DECIMAL(18,2)),:BALANCE_TL,'Bilet Yüklendi. (Bilet No='||CAST(:P_TICKET AS VARCHAR(12))||')');
  RESULT_CODE='ok'; AMOUNT_KURUS=P_AMOUNT; SUSPEND;
END";
        var rows = PanCafeReadOnly.Write(database, client, sql, args);
        if (rows[0]["RESULT_CODE"] == "unavailable") return TicketUnavailable();
        if (rows[0]["RESULT_CODE"] == "active") return TicketActiveSession();
        return rows;
    }

    sealed partial class NativeUi {
        IntPtr ticketDialog, ticketInput;
        static readonly string[] TicketSaleLabels = { "Bilet Satışı", "Bilet Satışı…" };

        public void OpenTicketSale() {
            if (FindTicketSaleDialog() != IntPtr.Zero)
                throw new InvalidOperationException("PanCafe’de bir bilet satış penceresi zaten açık. Önce kasadaki pencereyi kapat.");
            CheckIdle();
            Activate(main);
            if (GetForegroundWindow() != main)
                throw new InvalidOperationException("PanCafe ana penceresi öne getirilemedi.");
            if (!ClickMainToolbar(PanCafeScreenText.FindTicketToolbarIcon, 3))
                throw new InvalidOperationException("PanCafe Bilet sekmesi doğrulanamadı.");
            Thread.Sleep(450);
            var salePage = GetForegroundWindow();
            uint owner;
            GetWindowThreadProcessId(salePage, out owner);
            if (owner != processId || (salePage != main && salePage != GetLastActivePopup(main)) ||
                !ClickTicketSaleAction(salePage))
                throw new InvalidOperationException("PanCafe Bilet Satışı düğmesi bulunamadı.");
            ticketDialog = WaitForTicketSaleDialog(20);
            if (ticketDialog == IntPtr.Zero) throw new InvalidOperationException("PanCafe Bilet Satışı penceresi doğrulanamadı.");
        }

        IntPtr FindTicketSaleDialog() {
            var matches = Windows(null, processId, true).FindAll(h =>
                String.Equals(Class(h), "TSrvTicketSellFrm", StringComparison.OrdinalIgnoreCase));
            if (matches.Count > 1) throw new InvalidOperationException("PanCafe’de birden fazla bilet satışı penceresi açık.");
            return matches.Count == 1 ? matches[0] : IntPtr.Zero;
        }

        IntPtr WaitForTicketSaleDialog(int attempts) {
            for (int i = 0; i < attempts; i++) {
                var dialog = FindTicketSaleDialog();
                if (dialog != IntPtr.Zero) return dialog;
                Thread.Sleep(100);
            }
            return IntPtr.Zero;
        }

        public void EnterTicketBarcode(string barcode) {
            Activate(ticketDialog);
            if (GetForegroundWindow() != ticketDialog)
                throw new InvalidOperationException("PanCafe bilet satış penceresi öne getirilemedi.");
            ticketInput = ExactlyOne(Children(ticketDialog).FindAll(h =>
                IsWindowVisible(h) && IsWindowEnabled(h) && Class(h).EndsWith("Edit", StringComparison.Ordinal)), "Bilet No/Barkod");
            try { SetText(ticketInput, barcode); }
            catch (InvalidOperationException) { /* Some PanCafe input controls require typing. */ }
            if (Text(ticketInput) != barcode) TypeFocused(ticketDialog, ticketInput, barcode);
            if (Text(ticketInput) != barcode)
                throw new InvalidOperationException("PanCafe Bilet No/Barkod alanına barkod yazılamadı.");
        }

        public void SubmitTicketSale(string barcode) {
            if (GetForegroundWindow() != ticketDialog || Text(ticketInput) != barcode)
                throw new InvalidOperationException("PanCafe bilet alanı doğrulanamadı.");
            if (!ClickTicketAction(ticketDialog, new[] { "Tamam" }))
                throw new InvalidOperationException("PanCafe bilet onay düğmesi bulunamadı.");
        }

        bool ClickTicketAction(IntPtr scope, string[] labels) {
            if (GetForegroundWindow() != scope) return false;
            if (ClickNamed(scope, labels)) return true;
            var text = PanCafeScreenText.FindUnique(ReadScreenWords(AsRectangle(BoundsOf(scope))), labels[0], true);
            return !text.IsEmpty && ClickScreenText(scope, scope, text);
        }

        bool ClickTicketSaleAction(IntPtr scope) {
            if (GetForegroundWindow() != scope) return false;
            // PanCafe draws this action as a small label beside a yellow ticket.
            // Read smaller areas so OCR can enlarge the label before matching it.
            var box = AsRectangle(BoundsOf(scope));
            double dpi = GetDpiForWindow(scope) / 96.0;
            int width = Math.Min(box.Width, (int)(950 * dpi));
            int height = Math.Min(box.Height, (int)(800 * dpi));
            if (width <= 0 || height <= 0) return false;
            var left = new Rectangle(box.Left, box.Top, width, height);
            var right = new Rectangle(box.Right - width, box.Top, width, height);
            foreach (var area in new[] { left, right }) {
                if (GetForegroundWindow() != scope) return false;
                using (var page = new Bitmap(area.Width, area.Height)) {
                    using (var graphics = Graphics.FromImage(page))
                        graphics.CopyFromScreen(area.Location, System.Drawing.Point.Empty, area.Size);
                    var label = PanCafeScreenText.FindTicketSaleButton(page, dpi);
                    if (!label.IsEmpty) {
                        label.Offset(area.Location);
                        if (GetForegroundWindow() != scope) return false;
                        return ClickScreenText(scope, scope, label);
                    }
                }
                if (left == right) break;
            }
            return GetForegroundWindow() == scope && ClickNamed(scope, TicketSaleLabels);
        }

        public void CloseTicketSale() {
            if (ticketDialog != IntPtr.Zero && GetForegroundWindow() == ticketDialog && IsWindowVisible(ticketDialog))
                PostMessage(ticketDialog, 0x10, IntPtr.Zero, IntPtr.Zero);
        }
    }
}
