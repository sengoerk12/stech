using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

internal static partial class FbDb
{
    internal static void IsolatedTestSql(string database,string sql)
    {
        string prefix=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"PanCafeControllerTests-");
        if(!System.IO.Path.GetFullPath(database).StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new Exception("Test SQL requires an isolated temporary database.");
        try{Open(database,true);byte[] bytes=Encoding.UTF8.GetBytes(sql);Check(isc_dsql_execute_immediate(Status,ref Db,ref Tr,(ushort)bytes.Length,bytes,3,IntPtr.Zero));Commit();}
        finally{Close();}
    }
}

namespace STech.PanCafeBackend
{
    internal static class CoreBackendTests
    {
        private static int assertions;
        private static void Check(bool value,string message){if(!value)throw new Exception(message);assertions++;}
        private static string Snapshot(string database)
        {
            try
            {
                FbDb.Open(database,false);
                return NativeBridge.Json.Serialize(new{members=FbDb.Query("SELECT ID,USERNAME,BAKIYE,TOTALBAKIYE,LOGIN,AVAILBONUS,USEDBONUS FROM MEMBERS ORDER BY ID"),counts=FbDb.Query("SELECT (SELECT COUNT(*) FROM MEMBERSHISTORY) AS HISTORY_COUNT,(SELECT COUNT(*) FROM KASAHAR) AS CASH_COUNT FROM RDB$DATABASE")});
            }
            finally{FbDb.Close();}
        }
        private static void Reject(Action action,string message)
        {
            bool rejected=false;try{action();}catch(InvalidOperationException){rejected=true;}Check(rejected,message);
        }
        private static void RejectUnchanged(string path,Action action,string message)
        {
            string before=Snapshot(path);Reject(action,message);Check(before==Snapshot(path),message+" changed database state");
        }
        internal static int Run(string[] args)
        {
            string report=System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"database-tests.json");
            try
            {
                if(args.Length!=1)throw new ArgumentException("Consistent backup path required.");
                decimal parsed;
                Check(PanCafe.TryParseAmount("12,50",out parsed)&&parsed==12.5m,"Turkish amount");
                Check(PanCafe.TryParseAmount("12.50",out parsed)&&parsed==12.5m,"Decimal point amount");
                foreach(string bad in new[]{"0","-1","12,345","1e3","1.000,00","9999999999","","NaN"})Check(!PanCafe.TryParseAmount(bad,out parsed),"Rejected amount: "+bad);
                Check(ControllerDatabase.SqlText("o'brien")=="'o''brien'","Quoted identity escaping");
                NativeBridge.ProtocolSelfTest();Check(true,"Native protocol");
                int physicalChecks=NativeBridge.VerifyPhysicalFixture();Check(physicalChecks>=9,"Physical native fixture");assertions+=physicalChecks;
                Check(ControllerDatabase.IsUsableMac("00-11-22-33-44-55")&&ControllerDatabase.IsUsableMac("001122334455"),"PanCafe WOL MAC formats");
                foreach(string badMac in new[]{"",null,"00:11:22:33:44:55","00-00-00-00-00-00","FF-FF-FF-FF-FF-FF","01-11-22-33-44-55","00112233ZZ55"})Check(!ControllerDatabase.IsUsableMac(badMac),"Invalid WOL MAC rejected");
                var booting=new NativeReply{state=2,is_virtual=0,connected_after=0,terminal_id=22,terminal_after=5,login_after=1};
                long time=0;int polls=0;Action<int> delay=milliseconds=>time+=milliseconds;
                var connected=SessionConnectionWaiter.Wait(booting,()=>new NativeReply{state=2,terminal_id=22,terminal_after=5,login_after=1,connected_after=++polls==2?1:0},()=>time,delay,null,"PC",5000);
                Check(connected.connected_after==1&&polls==2,"Offline physical startup waits for client connection");
                polls=0;var virtualSession=new NativeReply{is_virtual=1};Check(Object.ReferenceEquals(virtualSession,SessionConnectionWaiter.Wait(virtualSession,()=>{polls++;return null;},()=>0,delay,null,"virtual",1000))&&polls==0,"Virtual session does not wait for a network client");
                bool timedOut=false;time=0;try{SessionConnectionWaiter.Wait(booting,()=>booting,()=>time,delay,null,"PC",2000);}catch(TimeoutException){timedOut=true;}Check(timedOut,"Unconnected physical session must time out instead of false success");
                time=0;Reject(()=>SessionConnectionWaiter.Wait(booting,()=>new NativeReply{state=2,terminal_id=99,terminal_after=5,login_after=1},()=>time,delay,null,"PC",2000),"Changed boot session must reject");
                int clockReads=0;timedOut=false;try{SessionConnectionWaiter.Wait(booting,()=>booting,()=>++clockReads<3?0:3000,_=>{throw new Exception("Negative deadline must not sleep");},null,"PC",1000);}catch(TimeoutException){timedOut=true;}Check(timedOut,"Deadline change must not produce a negative sleep");
                // The runner pins the supplied installed x86 engine before these tests.
                string directory=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"PanCafeControllerTests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
                string path=System.IO.Path.Combine(directory,"USDB.DAT");
                FbDb.BackupRestore(true,path,System.IO.Path.GetFullPath(args[0]),System.IO.Path.Combine(directory,"restore.log"));
                FbDb.IsolatedTestSql(path,"UPDATE VARIABLES SET VVALUE='0' WHERE VNAME='mbr_bonus_active'");
                FbDb.IsolatedTestSql(path,"UPDATE MEMBERS SET BAKIYE=40,TOTALBAKIYE=122.5,LOGIN=0,ACCSTATUS=1 WHERE ID=1");
                FbDb.IsolatedTestSql(path,"UPDATE TERMINALS SET TERMINALSTATUS=1,MEMBERID=1 WHERE ID=1");
                FbDb.IsolatedTestSql(path,"INSERT INTO MEMBERS (ID,USERNAME,PASSWORD,BAKIYE,TOTALBAKIYE,LOGIN,ACCSTATUS) VALUES (900001,'controller_test_ikinci','isolated-test',7.35,55.1,0,1)");
                FbDb.IsolatedTestSql(path,"INSERT INTO MEMBERS (ID,USERNAME,PASSWORD,BAKIYE,TOTALBAKIYE,LOGIN,ACCSTATUS) VALUES (900002,'o''brien_üye','isolated-test',5,8,0,1)");
                var db=new ControllerDatabase(path);
                MemberRecord first=db.FindMember("kaandeneme"),second=db.FindMember("controller_test_ikinci"),quoted=db.FindMember("o'brien_üye");
                Check(db.FindMember("KAANDENEME").Id==first.Id,"Canonical username lookup");
                Reject(()=>db.FindMember("' OR 1=1 --"),"SQL injection name should not resolve");
                var one=db.AddCredit(first,12.34m,40,0,0,1,Guid.NewGuid().ToString("N"),null,null);
                Check(one.member_id==1&&Math.Abs(one.balance_after-52.34m)<0.000001m&&Math.Abs(one.total_after-134.84m)<0.000001m,"Variable amount and totals");
                var cent=db.AddCredit(first,0.01m,52.34m,0,0,1,"one-cent",null,null);
                Check(Math.Abs(cent.balance_after-52.35m)<0.000001m,"One-cent credit");
                var two=db.AddCredit(second,0.29m,7.35m,0,0,1,Guid.NewGuid().ToString("N"),null,null);
                Check(two.member_id==900001&&Math.Abs(two.balance_after-7.64m)<0.000001m,"Another member and fractional double");
                var three=db.AddCredit(quoted,1.11m,5,0,0,1,Guid.NewGuid().ToString("N"),null,null);
                Check(Math.Abs(three.balance_after-6.11m)<0.000001m,"Quoted Unicode account");
                FbDb.IsolatedTestSql(path,"ALTER TABLE KASAHAR ADD CONSTRAINT CONTROLLER_TEST_FAIL CHECK (PRICE <> 13.37)");
                RejectUnchanged(path,()=>db.AddCredit(second,13.37m,7.64m,0,0,1,"rollback-test",null,null),"Cash constraint failure should roll back all records");
                FbDb.IsolatedTestSql(path,"ALTER TABLE KASAHAR DROP CONSTRAINT CONTROLLER_TEST_FAIL");
                RejectUnchanged(path,()=>db.AddCredit(second,2,999,0,0,1,"stale-model",null,null),"Stale model should reject");
                FbDb.IsolatedTestSql(path,"UPDATE MEMBERS SET LOGIN=1 WHERE ID=900001");
                FbDb.IsolatedTestSql(path,"UPDATE TERMINALS SET TERMINALSTATUS=5,MEMBERID=900001 WHERE ID=1");
                var active=db.AddCredit(second,6.25m,7.64m,1,1,1,"active-credit",null,null);
                Check(Math.Abs(active.balance_after-13.89m)<0.000001m&&db.FindMember(second.Username).Login==1,"Active account credit preserves login");
                RejectUnchanged(path,()=>db.AddCredit(second,1,13.89m,1,123,1,"wrong-terminal",null,null),"Active terminal mismatch should reject");
                FbDb.IsolatedTestSql(path,"UPDATE VARIABLES SET VVALUE='1' WHERE VNAME='mbr_bonus_active'");
                RejectUnchanged(path,()=>db.AddCredit(second,1,13.89m,1,1,1,"bonus-on",null,null),"Bonus mode must not be ignored");
                FbDb.IsolatedTestSql(path,"UPDATE VARIABLES SET VVALUE='0' WHERE VNAME='mbr_bonus_active'");
                RejectUnchanged(path,()=>db.AddCredit(second,1,13.89m,1,1,1,"commit-gate",receipt=>{throw new InvalidOperationException("Gate rejected");},null),"Rejected commit gate should roll back");
                var large=db.AddCredit(second,900000000.01m,13.89m,1,1,1,"large-amount",null,null);
                Check(Math.Abs(large.balance_after-900000013.90m)<0.000001m,"Large double/exponent conversion");
                var journal=new OperationJournal{id=Guid.NewGuid().ToString("N"),kind="test",username=second.Username,database=path,member_id=second.Id,created_utc=DateTime.UtcNow.ToString("o")};
                journal.FilePath=System.IO.Path.Combine(OperationJournal.DirectoryPath,journal.id+".json");journal.Save("unknown");
                try{Reject(()=>OperationJournal.CheckPending(second.Id,path),"Unknown outcome should prevent repeat");}finally{journal.Save("failed");}
                File.WriteAllText(report,NativeBridge.Json.Serialize(new{success=true,assertions=assertions,native_physical_fixture_checks=physicalChecks,physical_hardware_tested=false,connection_wait_verified=true,live_database_untouched=true,isolated_database=path,variable_amounts=true,multiple_members=true,active_account_sql=true,atomic_rollback=true,bonus_rejected=true,commit_gate_rollback=true,unknown_repeat_rejected=true}),new UTF8Encoding(false));return 0;
            }
            catch(Exception error){File.WriteAllText(report,NativeBridge.Json.Serialize(new{success=false,assertions=assertions,error=error.ToString()}));return 1;}
        }
    }
}
