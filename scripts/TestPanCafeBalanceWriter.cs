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
            PanCafeReadOnly.Write(copy,client,"UPDATE VARIABLES SET VVALUE='1' WHERE VNAME='mbr_bonus_active'",null);
            Expect(!PanCafeBalanceWriter.AutoMemberBonusDisabled(copy,client),"Enabled PanCafe bonus was accepted");
            var blocked=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100000,15000,Guid.NewGuid().ToString());
            Expect(blocked[0]["RESULT_CODE"]=="credit_ui_review","Enabled PanCafe bonus did not block a new credit");
            PanCafeReadOnly.Write(copy,client,"UPDATE VARIABLES SET VVALUE='0' WHERE VNAME='mbr_bonus_active'",null);
            Expect(PanCafeBalanceWriter.AutoMemberBonusDisabled(copy,client),"Disabled PanCafe bonus was not recognized");
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
            string marker="STechPOS-"+liveId.ToString("N");
            Expect(!PanCafeNativeSessions.CanRetryUnconfirmedCredit(copy,client,liveId.ToString(),marker),"A fresh attempt can still be processing");
            PanCafeReadOnly.Write(copy,client,"UPDATE STECH_LIVE_CREDIT_INTENTS SET CREATED_AT=DATEADD(-2 MINUTE TO CURRENT_TIMESTAMP) WHERE OPID=?",new[]{liveId.ToString()});
            Expect(PanCafeNativeSessions.CanRetryUnconfirmedCredit(copy,client,liveId.ToString(),marker),"An expired attempt without a credit was not eligible");
            Expect(PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString(),true)[0]["RESULT_CODE"]=="credit_ui_review",
                "An explicit retry could not reach the native path");
            PanCafeReadOnly.Write(copy,client,"INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,TARIH,SAAT,MIKTAR,KALAN,NOTE) VALUES(?,?,CURRENT_DATE,CURRENT_TIME,?,?,?)",
                new[]{username,"","1.25","1.25","Hesaba para yüklendi."});
            Expect(!PanCafeNativeSessions.CanRetryUnconfirmedCredit(copy,client,liveId.ToString(),marker),"An unlabelled credit must prevent a resend");
            PanCafeReadOnly.Write(copy,client,"INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE) VALUES(?,?,?,?,?)",
                new[]{username,"", "1.25", "223.50", "Nakit. STechPOS-"+liveId.ToString("N")});
            var confirmed=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString());
            Expect(confirmed[0]["RESULT_CODE"]=="ok" && confirmed[0]["BALANCE_TL"]=="223.50","Native history did not complete the receipt");
            Expect(!PanCafeNativeSessions.CanRetryUnconfirmedCredit(copy,client,liveId.ToString(),marker),"A confirmed native credit must prevent a resend");
            Expect(PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100,25,liveId.ToString())[0]["BALANCE_TL"]=="223.50",
                "A completed native load was not replayed safely");
            var transactions=PanCafeHistoryReader.Read(copy,client,memberId,username,0);
            Expect(transactions.Exists(item=>item["PAYMENT_ID"]==liveId.ToString() && item["PAID_KURUS"]=="100" && item["BONUS_KURUS"]=="25"),
                "Native load did not appear in payment history with the correct split");

            var totalId=Guid.NewGuid();
            PanCafeReadOnly.Write(copy,client,"INSERT INTO STECH_LIVE_CREDIT_INTENTS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,CREDIT_TOTAL) VALUES(?,?,?,?,?,?)",
                new[]{totalId.ToString(),memberId.ToString(CultureInfo.InvariantCulture),username,"100000","15000","115000"});
            var totalMarker="STechPOS-"+totalId.ToString("N");
            PanCafeReadOnly.Write(copy,client,"INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE) VALUES(?,?,?,?,?)",
                new[]{username,"","1000.00","1223.50",totalMarker});
            Expect(PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100000,15000,totalId.ToString())[0]["RESULT_CODE"]=="credit_review",
                "Only the card amount was credited but the full reload was accepted");
            PanCafeReadOnly.Write(copy,client,"UPDATE MEMBERSHISTORY SET MIKTAR=1150.00,KALAN=1373.50 WHERE NOTE=?",new[]{totalMarker});
            var totalCredit=PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100000,15000,totalId.ToString());
            Expect(totalCredit[0]["RESULT_CODE"]=="ok" && totalCredit[0]["BALANCE_TL"]=="1373.50","The combined credit was not confirmed");
            Expect(PanCafeNativeSessions.Credit(copy,client,Path.GetTempPath(),memberId,username,100000,15000,totalId.ToString())[0]["BALANCE_TL"]=="1373.50",
                "Rechecking the combined credit did not return its existing receipt");
            Console.WriteLine("Database copy: bonus switch, combined credit, legacy receipts, unavailable window and duplicate prevention passed.");return 0;
        } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
