using System;
using System.IO;
using System.Globalization;
public static class TestPanCafeBalanceWriter {
    static void Expect(bool value,string message) {if(!value)throw new Exception(message);}
    public static int Main(string[] args) {
        string copy=Path.Combine(Path.GetTempPath(),"stech-credit-test-"+Guid.NewGuid().ToString("N")+".dat");
        try {
            File.Copy(args[0],copy);
            string client=args[1],username="st_credit_"+Guid.NewGuid().ToString("N").Substring(0,8);
            PanCafeMemberWriter.Create(copy,client,new string[]{username,"CreditTest123!","Test","Credit","",""});
            int memberId=Int32.Parse(PanCafeReadOnly.Query(copy,client,"SELECT ID FROM MEMBERS WHERE USERNAME='"+username+"'")[0]["ID"]);
            PanCafeBalanceWriter.Initialize(copy,client);PanCafeBalanceWriter.Initialize(copy,client);
            string unavailableId=Guid.NewGuid().ToString();
            var queued=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,0,unavailableId);
            Expect(queued[0]["RESULT_CODE"]=="credit_ui_review","Unavailable native path did not preserve the payment for review");
            var member=PanCafeReadOnly.Query(copy,client,"SELECT CAST(BAKIYE AS DECIMAL(18,2)) AS B FROM MEMBERS WHERE ID="+memberId)[0];
            Expect(member["B"]=="0.00","Unavailable native path changed the member balance directly");
            Expect(PanCafeReadOnly.Query(copy,client,"SELECT COUNT(*) AS N FROM STECH_LIVE_CREDIT_INTENTS WHERE OPID='"+unavailableId+"'")[0]["N"]=="0","An unavailable payment was recorded as submitted");
            var legacyId=Guid.NewGuid().ToString();
            PanCafeReadOnly.Write(copy,client,"INSERT INTO STECH_MOBILE_CREDITS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,BALANCEAFTER) VALUES(?,?,?,?,?,?)",
                new[]{legacyId,memberId.ToString(CultureInfo.InvariantCulture),username,"100","0","31.00"});
            var legacy=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,0,legacyId);
            Expect(legacy[0]["BALANCE_TL"]=="31.00","A legacy completed receipt was not retained");
            var liveId=Guid.NewGuid();
            var liveArguments=new[]{liveId.ToString(), memberId.ToString(CultureInfo.InvariantCulture), username, "100", "25"};
            PanCafeReadOnly.Write(copy,client,"INSERT INTO STECH_LIVE_CREDIT_INTENTS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS) VALUES(?,?,?,?,?)",liveArguments);
            var unconfirmed=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString());
            Expect(unconfirmed[0]["RESULT_CODE"]=="credit_review","An unconfirmed native attempt was resent");
            PanCafeReadOnly.Write(copy,client,"INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE) VALUES(?,?,?,?,?)",
                new[]{username,"", "1.25", "223.50", "Nakit. STechPOS-"+liveId.ToString("N")});
            var confirmed=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString());
            Expect(confirmed[0]["RESULT_CODE"]=="ok" && confirmed[0]["BALANCE_TL"]=="223.50","Native history did not complete the receipt");
            Expect(PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString())[0]["BALANCE_TL"]=="223.50",
                "A completed native load was not replayed safely");
            var transactions=PanCafeHistoryReader.Read(copy,client,memberId,username,0);
            Expect(transactions.Exists(item=>item["PAYMENT_ID"]==liveId.ToString() && item["PAID_KURUS"]=="100" && item["BONUS_KURUS"]=="25"),
                "Native load did not appear in payment history with the correct split");
            Console.WriteLine("Database copy: unavailable PanCafe window, no direct balance change, legacy receipt, native history and duplicate prevention passed.");return 0;
        } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
