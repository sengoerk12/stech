using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using STech.PanCafeBackend;

public static partial class PanCafeNativeSessions {
    public static List<Dictionary<string,string>> CreditReadiness(string database,string client) {
        if(!PanCafeBalanceWriter.AutoMemberBonusDisabled(database,client))
            return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"READY","false"},{"MESSAGE","POS ile yükleme için PanCafe otomatik üye bonusu kapatılmalı. Şube yetkilisine başvur."}}};
        using(var lease=new BackendLease()) {
            if(lease.Acquired)try {
                // Verify the pinned application, x86 hook resource and configured
                // installation before the kiosk takes a payment. No hook/SQL write.
                using(var backend=OpenBackend(database,client)){}
                return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"READY","true"}}};
            } catch(InvalidOperationException){}catch(System.ComponentModel.Win32Exception){}
            return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"READY","false"},{"MESSAGE","PanCafe bağlantısı hazır değil. Biraz sonra tekrar dene veya şube yetkilisine başvur."}}};
        }
    }
    public static List<Dictionary<string,string>> Credit(string database,string client,string folder,
        int memberId,string username,long amount,long bonus,string operationId,bool retryUnconfirmed=false) {
        Guid operation=PanCafeBalanceWriter.Validate(memberId,username,amount,bonus,operationId);
        string id=operation.ToString(),marker="STechPOS-"+operation.ToString("N");
        var arguments=new[]{id,Invariant(memberId),username,Invariant(amount),Invariant(bonus)};
        using(var lease=new BackendLease()) {
            if(!lease.Acquired)return Result("active","PanCafe işlem sırası bekleniyor.");
            var completed=ReadCompletedCredit(database,client,arguments);
            var pending=PanCafeReadOnly.Query(database,client,
                "SELECT MEMBERID,USERNAME,AMOUNT,BONUS,CREDIT_TOTAL,NATIVE_BACKEND FROM STECH_LIVE_CREDIT_INTENTS WHERE OPID='"+id+"'");
            if(pending.Count==1)AssertCreditIdentity(pending[0],arguments);
            bool native=pending.Count==1&&pending[0]["NATIVE_BACKEND"]=="1";
            string journalId=BackendStorage.JournalId(database,"credit",id);
            if(completed.Count==1) {
                if(!native)return completed; // Preserve receipts from the former UI implementation.
                var journal=BackendStorage.Journal(journalId);
                if(journal!=null&&journal.status=="complete")return completed;
            }
            if(pending.Count==1&&!native&&completed.Count==0) {
                bool legacy=pending[0]["CREDIT_TOTAL"]==null;
                var previous=ConfirmLiveCredit(database,client,arguments,marker,amount,amount+bonus,legacy);
                if(previous[0]["RESULT_CODE"]=="ok"||!retryUnconfirmed||!CanRetryUnconfirmedCredit(database,client,id,marker))return previous;
            }
            if(pending.Count==1&&pending[0]["CREDIT_TOTAL"]!=null&&pending[0]["CREDIT_TOTAL"]!=Invariant(amount+bonus))
                throw new InvalidOperationException("Credit total conflict");
            try {
                using(var backend=OpenBackend(database,client)) {
                    var member=backend.Member(username);
                    if(member.Id!=memberId||member.Username!=username)throw new InvalidOperationException("Credit member mismatch");
                    if(!PanCafeBalanceWriter.AutoMemberBonusDisabled(database,client))
                        return Result("credit_ui_review","PanCafe otomatik üye bonusu kapatılmalı.");
                    // A durable intent identifies the backend. Actual money and the final receipt
                    // commit together inside the native main-thread handshake.
                    if(pending.Count==0)
                        PanCafeReadOnly.Write(database,client,
                            "INSERT INTO STECH_LIVE_CREDIT_INTENTS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,CREDIT_TOTAL,NATIVE_BACKEND) VALUES(?,?,?,?,?,?,1)",
                            new[]{id,Invariant(memberId),username,Invariant(amount),Invariant(bonus),Invariant(amount+bonus)});
                    else if(!native)
                        PanCafeReadOnly.Write(database,client,"UPDATE STECH_LIVE_CREDIT_INTENTS SET CREDIT_TOTAL=?,NATIVE_BACKEND=1 WHERE OPID=?",new[]{Invariant(amount+bonus),id});
                    backend.Invoke(1,member,null,(amount+bonus)/100m,journalId,new CreditRequest{OperationId=id,PaidKurus=amount,BonusKurus=bonus});
                    completed=ReadCompletedCredit(database,client,arguments);
                    if(completed.Count!=1)throw new PanCafe.BalanceOutcomeUnknownException(new InvalidOperationException("İşlem makbuzu bulunamadı."));
                    return completed;
                }
            } catch(PanCafe.BalanceOutcomeUnknownException error) {
                CreditDiagnostic(folder,id,error);
                return Result("credit_review","PanCafe işlemi doğrulanıyor. Aynı işlem kimliğiyle durum kontrol edilecek; yeniden para yüklenmeyecek.");
            } catch(NativeCommandRejectedException error) {
                CreditDiagnostic(folder,id,error);
                return Result(error.Code==9?"active":"credit_ui_review",error.Message);
            } catch(Exception error) {
                CreditDiagnostic(folder,id,error);
                return Result("credit_ui_review",error is InvalidOperationException?error.Message:"PanCafe arka plan bağlantısı hazır değil.");
            }
        }
    }

    static void CreditDiagnostic(string folder,string operation,Exception error) {
        if(String.IsNullOrEmpty(folder))return;
        try{BackendStorage.Save(Path.Combine(folder,"credit-readiness-error.json"),new{operationId=operation,backend="native",message=error.Message,at=DateTime.UtcNow.ToString("o")});}
        catch(IOException){}catch(UnauthorizedAccessException){}
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

}
