using System;
using System.IO;
public static class TestPanCafeAdminWriter {
 static void Expect(bool value,string message){if(!value)throw new Exception(message);}
 public static int Main(string[] args) {
  string copy=Path.Combine(Path.GetTempPath(),"stech-admin-test-"+Guid.NewGuid().ToString("N")+".dat");
  try {
   File.Copy(args[0],copy);string client=args[1],username="admtest_"+Guid.NewGuid().ToString("N").Substring(0,8);
   PanCafeMemberWriter.Create(copy,client,new string[]{username,"AdminTest123!","Test","Admin","",""});
   int id=Int32.Parse(PanCafeReadOnly.Query(copy,client,"SELECT ID FROM MEMBERS WHERE USERNAME='"+username+"'")[0]["ID"]);
   PanCafeAdminWriter.Initialize(copy,client);PanCafeAdminWriter.Initialize(copy,client);
   string op=Guid.NewGuid().ToString();
   var a=PanCafeAdminWriter.Adjust(copy,client,id,username,10000,0,0,0,"Test deposit",op);
   Expect(a[0]["RESULT_CODE"]=="ok" && a[0]["BALANCE_TL"]=="100.00","Deposit failed");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,10000,0,0,0,"Test deposit",op);
   Expect(a[0]["BALANCE_TL"]=="100.00","Duplicate credit");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,20000,0,0,0,"Test deposit",op);
   Expect(a[0]["RESULT_CODE"]=="conflict","Conflicting receipt accepted");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,2000,2000,10000,0,"Bonus award",Guid.NewGuid().ToString());
   Expect(a[0]["BALANCE_TL"]=="120.00" && a[0]["BONUS_TL"]=="20.00","Bonus incorrect");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,-5000,0,12000,2000,"Cash withdrawal",Guid.NewGuid().ToString());
   Expect(a[0]["BALANCE_TL"]=="70.00","Debit incorrect");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,-1000,-1000,7000,2000,"Bonus correction",Guid.NewGuid().ToString());
   Expect(a[0]["BALANCE_TL"]=="60.00" && a[0]["BONUS_TL"]=="10.00","Bonus debit incorrect");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,1000,0,7000,1000,"Stale balance",Guid.NewGuid().ToString());
   Expect(a[0]["RESULT_CODE"]=="stale","Stale balance accepted");
   a=PanCafeAdminWriter.Adjust(copy,client,id,username,-7000,0,6000,1000,"Overdraft test",Guid.NewGuid().ToString());
   Expect(a[0]["RESULT_CODE"]=="invalid","Overdraft accepted");
   a=PanCafeAdminWriter.Adjust(copy,client,id,"kaan2",1000,0,6000,1000,"Wrong identity",Guid.NewGuid().ToString());
   Expect(a[0]["RESULT_CODE"]=="stale","Wrong member accepted");
   PanCafeReadOnly.Write(copy,client,"ALTER TABLE MEMBERSHISTORY ADD CONSTRAINT STECH_ADMIN_FAIL CHECK(TERMINALNAME <> 'S TECH Admin' OR MIKTAR <> 13)",null);
   string failed=Guid.NewGuid().ToString();bool rolled=false;
   try {PanCafeAdminWriter.Adjust(copy,client,id,username,1300,0,6000,1000,"Rollback test",failed);}catch{rolled=true;}
   Expect(rolled,"Injected failure did not occur");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT CAST(BAKIYE AS DECIMAL(18,2)) AS B FROM MEMBERS WHERE ID="+id)[0]["B"]=="60.00","Rollback failed");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT COUNT(*) AS N FROM STECH_ADMIN_CHANGES WHERE OPID='"+failed+"'")[0]["N"]=="0","Receipt not rolled back");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT COUNT(*) AS N FROM MEMBERSHISTORY WHERE MEMBERS_USERNAME='"+username+"'")[0]["N"]=="4","History count incorrect");
   Console.WriteLine("PASS: copied database deposit/debit/bonus/idempotency/stale balance/identity/overdraft/atomic rollback.");return 0;
  } catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
 }
}
