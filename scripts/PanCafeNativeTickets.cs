using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using STech.PanCafeBackend;

public static partial class PanCafeNativeSessions {
    public static void InitializeTickets(string database,string client) {
        if(PanCafeReadOnly.Query(database,client,
            "SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_TICKET_CREDITS'").Count==0)
            PanCafeReadOnly.Write(database,client,"CREATE TABLE STECH_TICKET_CREDITS ("+
                "TICKET_ID INTEGER NOT NULL PRIMARY KEY,MEMBER_ID INTEGER NOT NULL,USERNAME VARCHAR(32) NOT NULL,"+
                "AMOUNT BIGINT NOT NULL,SALE_AFTER BIGINT NOT NULL,BALANCE_AFTER DECIMAL(18,2))",null);
    }
    public static List<Dictionary<string,string>> RedeemTicket(string database,string client,int memberId,string username,
        string barcode,string diagnosticFolder=null) {
        if(memberId<1||!Regex.IsMatch(username??"",@"\A[a-zA-Z0-9_.]{1,32}\z")||!Regex.IsMatch(barcode??"",@"\A[0-9]{10}\z"))
            throw new ArgumentException("Invalid ticket request");
        using(var lease=new BackendLease()) {
            if(!lease.Acquired)return Result("pending","PanCafe işlem sırası bekleniyor. Aynı bileti tekrar okut.");
            var tickets=PanCafeReadOnly.Query(database,client,
                "SELECT FIRST 2 ID,SOLD,USED,LOGIN,MEMBERCREDIT,CAST(PRICE AS DECIMAL(18,2)) AS PRICE_TL,"+
                "CASE WHEN EXPDATE IS NULL OR EXPDATE>=CURRENT_DATE THEN 1 ELSE 0 END AS VALID_DATE FROM TICKETS WHERE BARCODE='"+barcode+"'");
            long amount;
            if(tickets.Count!=1||tickets[0]["MEMBERCREDIT"]!="1"||!TryKurus(tickets[0]["PRICE_TL"],out amount)||amount<=0)
                return TicketUnavailable();
            var ticket=tickets[0];int ticketId=Int32.Parse(ticket["ID"],CultureInfo.InvariantCulture);
            var claims=PanCafeReadOnly.Query(database,client,
                "SELECT MEMBER_ID,USERNAME,AMOUNT,BALANCE_AFTER FROM STECH_TICKET_CREDITS WHERE TICKET_ID="+ticketId);
            if(claims.Count==1&&(claims[0]["MEMBER_ID"]!=Invariant(memberId)||claims[0]["USERNAME"]!=username||claims[0]["AMOUNT"]!=Invariant(amount)))
                return TicketUnavailable();
            string operation=new Guid(NativeBridge.Hash(Encoding.UTF8.GetBytes("ticket:"+Path.GetFullPath(database).ToUpperInvariant()+":"+ticketId)).Substring(0,32)).ToString();
            string journalId=BackendStorage.JournalId(database,"ticket",operation);
            bool completed=claims.Count==1&&claims[0]["BALANCE_AFTER"]!=null;
            var journal=BackendStorage.Journal(journalId);
            if(completed&&(journal==null||journal.status=="complete"))return Result("already_credited","Bu bilet daha önce hesabına yüklendi.");
            if(!completed&&(ticket["USED"]!="0"||ticket["LOGIN"]!="0"||ticket["VALID_DATE"]!="1"||(ticket["SOLD"]!="0"&&claims.Count!=1)))
                return TicketUnavailable();
            try {
                using(var backend=OpenBackend(database,client)) {
                    var member=backend.Member(username);
                    if(member.Id!=memberId||member.Username!=username)return TicketUnavailable();
                    if(member.Login!=0)return Result("active","Bilgisayardaki oyun oturumunu kapattıktan sonra aynı bileti tekrar okut.");
                    backend.Invoke(1,member,null,amount/100m,journalId,new CreditRequest{OperationId=operation,PaidKurus=amount,TicketId=ticketId,Barcode=barcode});
                }
                var receipt=PanCafeReadOnly.Query(database,client,
                    "SELECT CAST(BALANCE_AFTER AS DECIMAL(18,2)) AS BALANCE_TL FROM STECH_TICKET_CREDITS WHERE TICKET_ID="+ticketId+
                    " AND MEMBER_ID="+memberId+" AND USERNAME='"+username+"' AND AMOUNT="+amount+" AND BALANCE_AFTER IS NOT NULL");
                if(receipt.Count!=1)throw new InvalidOperationException("Bilet yükleme makbuzu doğrulanamadı.");
                if(completed)return Result("already_credited","Bu bilet daha önce hesabına yüklendi.");
                return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"RESULT_CODE","ok"},{"AMOUNT_KURUS",Invariant(amount)},{"BALANCE_TL",receipt[0]["BALANCE_TL"]}}};
            } catch(Exception error) {
                CreditDiagnostic(diagnosticFolder,"ticket-"+ticketId,error);
                return Result("pending","Bilet işlemi doğrulanamadı. Aynı bileti tekrar okut; ikinci kez bakiye yüklenmez. "+
                    (error is InvalidOperationException?error.Message:"PanCafe bağlantısını kontrol et."));
            }
        }
    }
    static List<Dictionary<string,string>> TicketUnavailable() {
        return Result("unavailable","Bilet bulunamadı, kullanılmış veya bu işlem için geçerli değil.");
    }
}
