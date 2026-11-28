using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using STech.PanCafeBackend;

// Kiosk contract and durable session receipts. All PanCafe business commands go
// through the verified x86 hook; this file does not send UI/input messages.
public static partial class PanCafeNativeSessions {
    const string WakingMessage="Bilgisayarınız açılıyor. PanCafe bağlantısı bekleniyor…";
    const string PendingMessage="PanCafe’de oturumunuz başlatılıyor…";
    const string InsufficientBalance="Bakiyeniz yetersiz. En az 10 TL gerekli.";
    static readonly TimeSpan ConnectionWait=TimeSpan.FromMinutes(3);
    static readonly HashSet<Guid> Running=new HashSet<Guid>();
    internal static Func<string,string,ILiveBackend> OpenBackend=(database,client)=>new HookBackend(database,client);

    public sealed class Receipt {
        // Keep legacy fields readable when updating an installed bridge.
        public string OperationId,Username,TerminalName,BeforeDate,BeforeTime,CreatedAtUtc;
        public string LastPollUtc,LastWakeUtc,TerminalMac,InputMode,NativeJournalId;
        public int MemberId,TerminalId,BackendVersion;
        public bool StartedWhileOffline,WaitingForOperator;
        public string Status="pending",Message="";
    }

    static Receipt ReadReceipt(string path){return BackendStorage.Read<Receipt>(path);}
    static bool WaitingStatus(string status){return status=="pending"||status=="waking";}
    static bool Unresolved(Receipt receipt){return WaitingStatus(receipt.Status)||receipt.Status=="review";}
    internal static HashSet<int> ReservedTerminals(string folder) {
        var result=new HashSet<int>();
        string directory=Path.Combine(folder,"session-operations");
        if(Directory.Exists(directory))foreach(string path in Directory.EnumerateFiles(directory,"*.json")) {
            var receipt=ReadReceipt(path);
            if(Unresolved(receipt))result.Add(receipt.TerminalId);
        }
        return result;
    }
    static Guid ValidateSession(int terminalId,int memberId,string username,string operationId) {
        Guid operation;
        if(terminalId<1||memberId<1||!Guid.TryParse(operationId,out operation)||!Regex.IsMatch(username??"",@"\A[a-zA-Z0-9_.]{1,32}\z"))
            throw new ArgumentException("Invalid session request");
        return operation;
    }
    static bool SameRequest(Receipt receipt,int terminalId,int memberId,string username) {
        return receipt.TerminalId==terminalId&&receipt.MemberId==memberId&&receipt.Username==username;
    }

    public static List<Dictionary<string,string>> Start(string database,string client,string folder,
        int terminalId,int memberId,string username,string operationId) {
        Guid operation=ValidateSession(terminalId,memberId,username,operationId);
        var result=StartOnce(database,client,folder,terminalId,memberId,username,operation);
        if(WaitingStatus(result[0]["RESULT_CODE"])) {
            bool schedule;lock(Running)schedule=Running.Add(operation);
            if(schedule)Task.Run(()=>Continue(database,client,folder,terminalId,memberId,username,operation));
        }
        return result;
    }

    internal static List<Dictionary<string,string>> StartOnce(string database,string client,string folder,
        int terminalId,int memberId,string username,Guid operation) {
        using(var lease=new BackendLease()) {
            if(!lease.Acquired)return Result("busy","PanCafe işlem sırası bekleniyor. Biraz sonra tekrar dene.");
            string directory=Path.Combine(folder,"session-operations");Directory.CreateDirectory(directory);
            string path=Path.Combine(directory,operation.ToString()+".json");
            if(File.Exists(path)) {
                var previous=ReadReceipt(path);
                if(!SameRequest(previous,terminalId,memberId,username))return Result("conflict","İşlem bilgileri bu hesapla eşleşmiyor.");
                return Observe(database,client,path,previous);
            }
            foreach(string priorPath in Directory.EnumerateFiles(directory,"*.json")) {
                var prior=ReadReceipt(priorPath);
                if((prior.MemberId==memberId||prior.TerminalId==terminalId)&&Unresolved(prior))
                    return Result("busy","Bu üye veya bilgisayar için önceki oturum işlemi doğrulama bekliyor.");
            }
            var receipt=new Receipt{OperationId=operation.ToString(),MemberId=memberId,TerminalId=terminalId,Username=username,
                CreatedAtUtc=DateTime.UtcNow.ToString("o"),InputMode="native",BackendVersion=1,
                NativeJournalId=BackendStorage.JournalId(database,"session",operation.ToString())};
            bool dispatching=false;
            try {
                var terminal=Terminal(database,client,terminalId);
                receipt.TerminalName=terminal["NAME"];receipt.TerminalMac=terminal["MAC"];
                receipt.BeforeDate=terminal["STARTDATE"];receipt.BeforeTime=terminal["STARTTIME"];
                if(terminal["TERMINALTYPE"]!="0"||(terminal["ISVIRTUAL"]!="0"&&terminal["ISVIRTUAL"]!="1")||
                    (terminal["ISVIRTUAL"]=="0"&&terminal["NOMEMBERLOGIN"]!="0"))
                    return Finish(path,receipt,"unsupported","Bu bilgisayarda kiosktan üye oturumu açılamıyor.");
                if(terminal["TERMINALSTATUS"]!="1"&&(terminal["ISVIRTUAL"]!="0"||terminal["TERMINALSTATUS"]!="0"))
                    return Finish(path,receipt,"occupied","Bu bilgisayar artık boş değil. Başka bir bilgisayar seç.");
                using(var backend=OpenBackend(database,client)) {
                    var member=backend.Member(username);
                    if(member.Id!=memberId||member.Username!=username||member.Expired)
                        return Finish(path,receipt,"member","Üyeliğini kontrol et.");
                    if(member.Login!=0)return Finish(path,receipt,"active","Zaten açık bir üye oturumun var.");
                    if(member.Balance<10m)return Finish(path,receipt,"insufficient_balance",InsufficientBalance);
                    var target=backend.Terminal(receipt.TerminalName);
                    if(target.Id!=terminalId)throw new InvalidOperationException("Bilgisayar kimliği değişti.");
                    // Persist before dispatch. After this point a crash must never cause
                    // another StartSession or a second opening charge on retry.
                    BackendStorage.Save(path,receipt);dispatching=true;
                    var reply=backend.Invoke(2,member,target,0,receipt.NativeJournalId,null);
                    receipt.StartedWhileOffline=reply.is_virtual==0&&reply.connected_after==0;
                    if(receipt.StartedWhileOffline)return Finish(path,receipt,"waking",WakingMessage);
                    return Finish(path,receipt,"started","PanCafe’de üye oturumun başladı.");
                }
            } catch(PanCafe.SessionOutcomeUnknownException error) {
                return Finish(path,receipt,"review",error.Message);
            } catch(NativeCommandRejectedException error) {
                return Finish(path,receipt,error.Code==6?"occupied":"failed",error.Message);
            } catch(Exception error) {
                return Finish(path,receipt,dispatching?"review":"failed",error is InvalidOperationException?error.Message:"PanCafe arka plan bağlantısına ulaşılamadı.");
            }
        }
    }

    static async Task Continue(string database,string client,string folder,int terminalId,int memberId,string username,Guid operation) {
        try {
            while(true) {
                await Task.Delay(1000).ConfigureAwait(false);
                try {
                    var result=Status(database,client,folder,terminalId,memberId,username,operation.ToString());
                    if(!WaitingStatus(result[0]["RESULT_CODE"]))return;
                } catch(Exception error) {
                    System.Diagnostics.Trace.TraceWarning("PanCafe session status failed: {0}",error.GetType().Name);
                    // Status is read-only. The durable receipt remains for the next poll.
                }
                string path=Path.Combine(folder,"session-operations",operation.ToString()+".json");
                if(BackendStorage.OlderThan(ReadReceipt(path).CreatedAtUtc,ConnectionWait+TimeSpan.FromSeconds(30)))return;
            }
        } finally{lock(Running)Running.Remove(operation);}
    }

    // Status never dispatches StartSession or WOL. It can recover after a bridge
    // restart by inspecting the exact member/terminal through native operation 4.
    public static List<Dictionary<string,string>> Status(string database,string client,string folder,
        int terminalId,int memberId,string username,string operationId) {
        Guid operation=ValidateSession(terminalId,memberId,username,operationId);
        using(var lease=new BackendLease()) {
            if(!lease.Acquired)return Result("pending",PendingMessage);
            string path=Path.Combine(folder,"session-operations",operation.ToString()+".json");
            if(!File.Exists(path))return Result("not_started","Bu işlem PanCafe’de başlatılmadı. Bilgisayarı yeniden seçebilirsin.");
            var receipt=ReadReceipt(path);
            if(!SameRequest(receipt,terminalId,memberId,username))return Result("conflict","İşlem bilgileri bu hesapla eşleşmiyor.");
            return Observe(database,client,path,receipt);
        }
    }

    static List<Dictionary<string,string>> Observe(string database,string client,string path,Receipt receipt) {
        if(!WaitingStatus(receipt.Status))return Result(receipt.Status,receipt.Message);
        if(receipt.BackendVersion!=1) {
            // No native command was posted for the former wake/operator-wait state.
            if(receipt.Status=="waking")return Finish(path,receipt,"failed","Eski açılış isteği sona erdi. Bilgisayarı yeniden seçebilirsin.");
            return Finish(path,receipt,"review","Önceki ekran otomasyonu isteğini PanCafe’den kontrol et; otomatik tekrar gönderilmedi.");
        }
        if(receipt.NativeJournalId!=BackendStorage.JournalId(database,"session",receipt.OperationId))
            return Finish(path,receipt,"review","Oturum günlüğü eşleşmiyor. Kasadan kontrol et; yeni açılış gönderilmedi.");
        try {
            using(var backend=OpenBackend(database,client)) {
                var member=backend.Member(receipt.Username);var terminal=backend.Terminal(receipt.TerminalName);
                if(member.Id!=receipt.MemberId||terminal.Id!=receipt.TerminalId)throw new InvalidOperationException("Oturum kimliği değişti.");
                var reply=backend.Invoke(4,member,terminal,0,null,null);
                if(reply.state!=2||reply.login_after!=1||reply.terminal_after!=5||reply.terminal_id!=receipt.TerminalId)
                    throw new InvalidOperationException("Oturumun üye ve bilgisayar bağlantısı doğrulanamadı.");
                if(reply.is_virtual!=0||reply.connected_after!=0) {
                    BackendStorage.FinishJournal(receipt.NativeJournalId,"complete");
                    return Finish(path,receipt,"started","PanCafe’de üye oturumun başladı.");
                }
            }
        } catch(Exception error) {
            if(BackendStorage.OlderThan(receipt.CreatedAtUtc,ConnectionWait)||error is NativeCommandRejectedException) {
                BackendStorage.FinishJournal(receipt.NativeJournalId,"unknown");
                return Finish(path,receipt,"review","Oturum başlatılmış olabilir; tekrar açılış gönderilmedi. "+error.Message);
            }
            return Result("pending",PendingMessage);
        }
        if(BackendStorage.OlderThan(receipt.CreatedAtUtc,ConnectionWait)) {
            BackendStorage.FinishJournal(receipt.NativeJournalId,"unknown");
            return Finish(path,receipt,"review","Oturum PanCafe’de kayıtlı, fakat bilgisayar 3 dakika içinde bağlanmadı. Kasadan kontrol et; yeni açılış gönderilmedi.");
        }
        return Finish(path,receipt,"waking",WakingMessage);
    }

    static Dictionary<string,string> Terminal(string database,string client,int id) {
        var rows=PanCafeReadOnly.Query(database,client,
            "SELECT ID,NAME,TERMINALTYPE,ISVIRTUAL,TERMINALSTATUS,NOMEMBERLOGIN,MAC,MEMBERID,CAST(STARTDATE AS VARCHAR(30)) AS STARTDATE,CAST(STARTTIME AS VARCHAR(30)) AS STARTTIME FROM TERMINALS WHERE ID="+id.ToString(CultureInfo.InvariantCulture));
        if(rows.Count!=1)throw new InvalidOperationException("Bilgisayar bulunamadı.");return rows[0];
    }
    static List<Dictionary<string,string>> Finish(string path,Receipt receipt,string status,string message) {
        receipt.Status=status;receipt.Message=message;BackendStorage.Save(path,receipt);return Result(status,message);
    }
    static List<Dictionary<string,string>> Result(string code,string message) {
        return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"RESULT_CODE",code},{"MESSAGE",message??""}}};
    }
}
