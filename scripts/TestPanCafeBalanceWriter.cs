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
            string operation=Guid.NewGuid().ToString();
            var result=PanCafeBalanceWriter.Credit(copy,client,memberId,username,20000,2000,operation);
            Expect(result[0]["BALANCE_TL"]=="220.00","First credit mismatch");
            PanCafeBalanceWriter.Credit(copy,client,memberId,username,20000,2000,operation);
            var member=PanCafeReadOnly.Query(copy,client,"SELECT CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE,CAST(AVAILBONUS AS DECIMAL(18,2)) AS BONUS FROM MEMBERS WHERE ID="+memberId.ToString(CultureInfo.InvariantCulture))[0];
            Expect(member["BALANCE"]=="220.00" && member["BONUS"]=="20.00","Balance or bonus incorrect");
            Expect(PanCafeReadOnly.Query(copy,client,"SELECT COUNT(*) AS N FROM MEMBERSHISTORY WHERE MEMBERS_USERNAME='"+username+"'")[0]["N"]=="1","Duplicate history");
            bool conflict=false;try{PanCafeBalanceWriter.Credit(copy,client,memberId,username,5000,0,operation);}catch{conflict=true;}
            Expect(conflict,"Idempotency conflict accepted");
            bool mismatch=false;try{PanCafeBalanceWriter.Credit(copy,client,memberId,"kaan2",5000,0,Guid.NewGuid().ToString());}catch{mismatch=true;}
            Expect(mismatch,"Wrong username accepted");
            PanCafeReadOnly.Write(copy,client,"ALTER TABLE MEMBERSHISTORY ADD CONSTRAINT STECH_TEST_FAIL CHECK(TERMINALNAME <> 'S TECH Mobile' OR MIKTAR <> 50)",null);
            string failedOperation=Guid.NewGuid().ToString();bool rollback=false;
            try{PanCafeBalanceWriter.Credit(copy,client,memberId,username,5000,0,failedOperation);}catch{rollback=true;}
            Expect(rollback,"Injected history failure accepted");
            Expect(PanCafeReadOnly.Query(copy,client,"SELECT CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE FROM MEMBERS WHERE ID="+memberId)[0]["BALANCE"]=="220.00","Failed transaction changed balance");
            Expect(PanCafeReadOnly.Query(copy,client,"SELECT COUNT(*) AS N FROM STECH_MOBILE_CREDITS WHERE OPID='"+failedOperation+"'")[0]["N"]=="0","Failed transaction retained receipt");
            Console.WriteLine("Database copy: native credit, bonus, history, duplicate prevention, member identity, conflict and atomic rollback passed.");return 0;
        } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
