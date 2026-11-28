using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace STech.PanCafeBackend
{
    // Only this assembly can select a fake backend. All SQL is confined to a
    // restored temporary database; the fake never opens a live PanCafe process.
    internal static class BridgeIntegrationTests
    {
        static int assertions,starts,credits,polls;
        static bool connected,loseCreditReply,loseSessionReply;
        static string database,client,directory;
        static string Number(decimal value){return value.ToString(CultureInfo.InvariantCulture);}
        static void Check(bool value,string message){if(!value)throw new Exception(message);assertions++;}
        static void Sql(string sql){FbDb.IsolatedTestSql(database,sql);}
        static List<Dictionary<string,string>> Query(string sql){return PanCafeReadOnly.Query(database,client,sql);}
        static string Code(List<Dictionary<string,string>> result){return result[0]["RESULT_CODE"];}
        static int Count(string table){return Int32.Parse(Query("SELECT COUNT(*) AS N FROM "+table)[0]["N"]);}
        static decimal Balance(){return new ControllerDatabase(database).FindMember("bridge_test").Balance;}
        static string Snapshot(){return NativeBridge.Json.Serialize(new{balance=Balance(),cash=Count("KASAHAR"),history=Count("MEMBERSHISTORY"),credits=Count("STECH_MOBILE_CREDITS"),tickets=Query("SELECT ID,SOLD,USED FROM TICKETS WHERE ID>=980001 ORDER BY ID")});}
        sealed class FakeBackend : ILiveBackend
        {
            readonly ControllerDatabase db;
            internal FakeBackend(string path){db=new ControllerDatabase(path);}
            public MemberRecord Member(string username){return db.FindMember(username);}
            public TerminalRecord Terminal(string name){return db.FindTerminal(name);}
            public NativeReply Invoke(int operation,MemberRecord member,TerminalRecord terminal,decimal amount,string journalId,CreditRequest request)
            {
                if(operation==1)
                {
                    credits++;
                    var receipt=db.AddCredit(member,amount,member.Balance,member.Login,member.Login==1?1:0,1,journalId,null,null,request);
                    if(loseCreditReply){loseCreditReply=false;throw new PanCafe.BalanceOutcomeUnknownException(new TimeoutException("simulated lost reply after commit"));}
                    return new NativeReply{state=2,balance_after=receipt.balance_after};
                }
                if(operation==2)
                {
                    starts++;Sql("UPDATE MEMBERS SET LOGIN=1 WHERE ID="+member.Id);
                    Sql("UPDATE TERMINALS SET TERMINALSTATUS=5,MEMBERID="+member.Id+" WHERE ID="+terminal.Id);
                    if(loseSessionReply){loseSessionReply=false;throw new PanCafe.SessionOutcomeUnknownException(new TimeoutException("simulated lost start reply"));}
                }
                else if(operation==4)polls++;
                else throw new Exception("Unexpected fake operation "+operation);
                try{db.VerifySession(member.Id,terminal.Id);}catch{throw new NativeCommandRejectedException(19,"Session changed");}
                return new NativeReply{state=2,terminal_id=terminal.Id,terminal_after=5,login_after=1,is_virtual=terminal.IsVirtual?1:0,connected_after=connected?1:0};
            }
            public void Dispose(){}
        }
        static string NewFolder(){string folder=Path.Combine(directory,Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);return folder;}
        static void ResetSession()
        {Sql("UPDATE MEMBERS SET LOGIN=0,BAKIYE=100 WHERE ID=980001");Sql("UPDATE TERMINALS SET TERMINALSTATUS=1,MEMBERID=980001,ISVIRTUAL=0,NOMEMBERLOGIN=0 WHERE ID=1");}
        static List<Dictionary<string,string>> Credit(string id,long amount=100,long bonus=0)
        {return PanCafeNativeSessions.Credit(database,client,directory,980001,"bridge_test",amount,bonus,id);}
        static List<Dictionary<string,string>> Start(string folder,Guid id)
        {return PanCafeNativeSessions.StartOnce(database,client,folder,1,980001,"bridge_test",id);}
        static List<Dictionary<string,string>> Status(string folder,Guid id)
        {return PanCafeNativeSessions.Status(database,client,folder,1,980001,"bridge_test",id.ToString());}
        static List<Dictionary<string,string>> Ticket(string barcode,int member=980001,string username="bridge_test")
        {return PanCafeNativeSessions.RedeemTicket(database,client,member,username,barcode,directory);}
        static void NewTicket(int id,string barcode,decimal price)
        {Sql("INSERT INTO TICKETS (ID,BARCODE,PARTNO,PASS,PRICE,MEMBERCREDIT) VALUES ("+id+",'"+barcode+"','native-test','test',"+Number(price)+",1)");}
        static int Main(string[] args)
        {
            var original=PanCafeNativeSessions.OpenBackend;
            try
            {
                if(args.Length!=2)throw new ArgumentException("Consistent backup and installed Firebird Core directory required.");
                client=Path.GetFullPath(args[1]);NativeBridge.ConfigureFirebird(client);
                if(CoreBackendTests.Run(new[]{args[0]})!=0)throw new Exception(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"database-tests.json")));
                directory=Path.Combine(Path.GetTempPath(),"PanCafeControllerTests-STech-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
                database=Path.Combine(directory,"USDB.DAT");FbDb.BackupRestore(true,database,Path.GetFullPath(args[0]),Path.Combine(directory,"restore.log"));
                PanCafeBalanceWriter.Initialize(database,client);PanCafeBalanceWriter.Initialize(database,client);
                PanCafeNativeSessions.InitializeTickets(database,client);PanCafeNativeSessions.InitializeTickets(database,client);
                Sql("UPDATE VARIABLES SET VVALUE='0' WHERE VNAME='mbr_bonus_active'");
                Sql("UPDATE TERMINALS SET TERMINALSTATUS=1,MEMBERID=0 WHERE ID=1");
                Sql("INSERT INTO MEMBERS (ID,USERNAME,PASSWORD,BAKIYE,TOTALBAKIYE,LOGIN,ACCSTATUS) VALUES (980001,'bridge_test','isolated-only',100,100,0,1)");
                Sql("INSERT INTO MEMBERS (ID,USERNAME,PASSWORD,BAKIYE,TOTALBAKIYE,LOGIN,ACCSTATUS) VALUES (980002,'bridge_other','isolated-only',100,100,0,1)");
                PanCafeNativeSessions.OpenBackend=(path,core)=>{Check(path==database&&core==client,"Fake backend must stay on the restored database");return new FakeBackend(path);};
                string readinessBefore=Snapshot();
                Check(PanCafeNativeSessions.CreditReadiness(database,client)[0]["READY"]=="true"&&credits==0&&Snapshot()==readinessBefore,"Native readiness must not submit a credit or mutate the database");
                var factory=PanCafeNativeSessions.OpenBackend;
                PanCafeNativeSessions.OpenBackend=(path,core)=>{throw new InvalidOperationException("Unsupported executable fixture");};
                var readiness=PanCafeNativeSessions.CreditReadiness(database,client)[0];
                Check(readiness["READY"]=="false"&&readiness["MESSAGE"].Contains("bağlantısı hazır değil")&&Snapshot()==readinessBefore,"Unsupported native connection must block payment preflight without changing data");
                PanCafeNativeSessions.OpenBackend=factory;

                string id=Guid.NewGuid().ToString();int cash=Count("KASAHAR"),history=Count("MEMBERSHISTORY");
                Check(Code(Credit(id,10000,1500))=="ok"&&Balance()==215m,"Paid amount and bonus must reach the native transaction together");
                Check(Count("KASAHAR")==cash+1&&Count("MEMBERSHISTORY")==history+1,"One cash and member history entry");
                string snapshot=Snapshot();Check(Code(Credit(id,10000,1500))=="ok"&&Snapshot()==snapshot,"Same operation must not add money twice");
                bool conflict=false;try{Credit(id,10100,1500);}catch(InvalidOperationException){conflict=true;}Check(conflict&&Snapshot()==snapshot,"Changed operation payload must be rejected");
                Check(PanCafeHistoryReader.Read(database,client,980001,"bridge_test",0).Exists(row=>row["PAYMENT_ID"]==id&&row["PAID_KURUS"]=="10000"&&row["BONUS_KURUS"]=="1500"),"Payment history retains the amount/bonus split");

                id=Guid.NewGuid().ToString();Sql("ALTER TABLE KASAHAR ADD CONSTRAINT STECH_TEST_FAIL CHECK (PRICE<>13.37)");snapshot=Snapshot();
                Check(Code(Credit(id,1337))=="credit_ui_review"&&Snapshot()==snapshot,"Cash failure must roll back balance, history and final receipt");
                Sql("ALTER TABLE KASAHAR DROP CONSTRAINT STECH_TEST_FAIL");Check(Code(Credit(id,1337))=="ok"&&Balance()==228.37m,"Rolled back native request can be retried safely");
                id=Guid.NewGuid().ToString();loseCreditReply=true;
                Check(Code(Credit(id))=="credit_review"&&Balance()==229.37m,"Lost post-commit reply must keep the payment uncertain");
                snapshot=Snapshot();Check(Code(Credit(id))=="ok"&&Snapshot()==snapshot,"Recovery must reuse the atomic receipt without another credit");

                // A previous UI intent must be observed, never silently replayed.
                id=Guid.NewGuid().ToString();PanCafeReadOnly.Write(database,client,"INSERT INTO STECH_LIVE_CREDIT_INTENTS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS) VALUES(?,?,?,?,?)",new[]{id,"980001","bridge_test","100","0"});
                int before=credits;Check(Code(Credit(id))=="credit_review"&&credits==before,"Unconfirmed legacy UI intent must not enter the native write path");
                PanCafeReadOnly.Write(database,client,"INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE) VALUES(?,?,?,?,?)",new[]{"bridge_test","","1.00","230.37","STechPOS-"+Guid.Parse(id).ToString("N")});
                Check(Code(Credit(id))=="ok"&&credits==before,"Completed legacy history must retain its old receipt");

                ResetSession();connected=false;var operation=Guid.NewGuid();string folder=NewFolder();before=starts;
                Check(Code(Start(folder,operation))=="waking"&&starts==before+1,"Offline physical session must start once and wait for its client");
                Check(Code(Start(folder,operation))=="waking"&&starts==before+1,"Repeated POST must only observe the same session");
                Check(Code(Status(folder,operation))=="waking"&&polls>0&&starts==before+1,"Status must only poll native operation 4");
                Check(Code(Start(folder,Guid.NewGuid()))=="busy"&&starts==before+1,"Another operation for the waiting member/PC must be blocked");
                connected=true;Check(Code(Status(folder,operation))=="started"&&starts==before+1,"Only a connected physical client completes startup");
                Check(Code(Status(folder,Guid.NewGuid()))=="not_started","An unknown status lookup must not start a session");
                Check(Code(PanCafeNativeSessions.Status(database,client,folder,1,980002,"bridge_other",operation.ToString()))=="conflict","Receipt ownership must be verified");

                ResetSession();connected=false;folder=NewFolder();operation=Guid.NewGuid();Check(Code(Start(folder,operation))=="waking","Second offline fixture");
                string file=Path.Combine(folder,"session-operations",operation.ToString()+".json");var receipt=BackendStorage.Read<PanCafeNativeSessions.Receipt>(file);receipt.CreatedAtUtc=DateTime.UtcNow.AddMinutes(-4).ToString("o");BackendStorage.Save(file,receipt);before=starts;
                Check(Code(Status(folder,operation))=="review"&&starts==before,"Connection timeout must not send another start or pretend failure before a possible charge");
                Check(PanCafeNativeSessions.ReservedTerminals(folder).Contains(1),"Uncertain session remains reserved");
                ResetSession();connected=true;loseSessionReply=true;folder=NewFolder();operation=Guid.NewGuid();before=starts;
                Check(Code(Start(folder,operation))=="review"&&starts==before+1,"Lost session reply must require review");
                Check(Code(Start(folder,operation))=="review"&&starts==before+1,"Uncertain start must not be dispatched twice");
                ResetSession();Sql("UPDATE MEMBERS SET BAKIYE=9.99 WHERE ID=980001");before=starts;
                Check(Code(Start(NewFolder(),Guid.NewGuid()))=="insufficient_balance"&&starts==before,"Existing kiosk 10 TL minimum remains enforced");

                ResetSession();NewTicket(980001,"9780000001",25.5m);before=Count("KASAHAR");history=Count("MEMBERSHISTORY");
                Check(Code(Ticket("9780000001"))=="ok"&&Balance()==125.5m,"Unsold ticket sale and member credit must commit together");
                Check(Count("KASAHAR")==before+1&&Count("MEMBERSHISTORY")==history+1&&Query("SELECT SOLD,USED FROM TICKETS WHERE ID=980001")[0]["USED"]=="1","Ticket creates one sale and is consumed");
                snapshot=Snapshot();Check(Code(Ticket("9780000001"))=="already_credited"&&Snapshot()==snapshot,"Same barcode cannot credit twice");
                Check(Code(Ticket("9780000001",980002,"bridge_other"))=="unavailable"&&Snapshot()==snapshot,"A different member cannot claim the ticket");
                NewTicket(980002,"9780000002",13.37m);Sql("ALTER TABLE KASAHAR ADD CONSTRAINT STECH_TICKET_TEST_FAIL CHECK (PRICE<>13.37)");snapshot=Snapshot();
                Check(Code(Ticket("9780000002"))=="pending"&&Snapshot()==snapshot,"Ticket sale failure must roll back ticket consumption, balance and history");
                Sql("ALTER TABLE KASAHAR DROP CONSTRAINT STECH_TICKET_TEST_FAIL");Check(Code(Ticket("9780000002"))=="ok"&&Balance()==138.87m,"Rolled back ticket can be redeemed once");
                NewTicket(980003,"9780000003",10);Sql("UPDATE TICKETS SET SOLD=1 WHERE ID=980003");
                PanCafeReadOnly.Write(database,client,"INSERT INTO STECH_TICKET_CREDITS(TICKET_ID,MEMBER_ID,USERNAME,AMOUNT,SALE_AFTER) VALUES(980003,980001,'bridge_test',1000,0)",null);
                PanCafeReadOnly.Write(database,client,"INSERT INTO KASAHAR(ADMINNAME,ISLEM,GELIRGIDER,TARIH,PRICE,NOTE,PAYMENTTYPE) VALUES('test',8,0,CURRENT_TIMESTAMP,10,'Bilet No:980003',0)",null);before=Count("KASAHAR");
                Check(Code(Ticket("9780000003"))=="ok"&&Balance()==148.87m&&Count("KASAHAR")==before,"An unfinished legacy ticket sale must reuse its existing cash receipt");
                NewTicket(980004,"9780000004",5);loseCreditReply=true;
                Check(Code(Ticket("9780000004"))=="pending"&&Balance()==153.87m,"Lost ticket reply preserves the committed receipt");snapshot=Snapshot();
                Check(Code(Ticket("9780000004"))=="already_credited"&&Snapshot()==snapshot,"Rechecking a committed ticket must not add balance again");
                NewTicket(980005,"9780000005",5);Sql("UPDATE TICKETS SET EXPDATE=CURRENT_DATE-1 WHERE ID=980005");before=credits;
                Check(Code(Ticket("9780000005"))=="unavailable"&&credits==before,"Expired ticket must be rejected before native credit");
                NewTicket(980006,"9780000006",5);Sql("UPDATE TICKETS SET SOLD=1 WHERE ID=980006");before=credits;
                Check(Code(Ticket("9780000006"))=="unavailable"&&credits==before,"A sold ticket without a durable member claim must not be appropriated");
                PanCafeReadOnly.Write(database,client,"INSERT INTO STECH_TICKET_CREDITS(TICKET_ID,MEMBER_ID,USERNAME,AMOUNT,SALE_AFTER) VALUES(980006,980001,'bridge_test',500,0)",null);snapshot=Snapshot();
                Check(Code(Ticket("9780000006"))=="pending"&&Snapshot()==snapshot,"A legacy claim without its cash sale must not credit money");
                NewTicket(980007,"9780000007",5);Sql("UPDATE MEMBERS SET LOGIN=1 WHERE ID=980001");before=credits;
                Check(Code(Ticket("9780000007"))=="active"&&credits==before,"Ticket redemption preserves the closed member-session requirement");Sql("UPDATE MEMBERS SET LOGIN=0 WHERE ID=980001");
                Sql("UPDATE VARIABLES SET VVALUE='1' WHERE VNAME='mbr_bonus_active'");snapshot=Snapshot();before=credits;
                Check(Code(Credit(Guid.NewGuid().ToString()))=="credit_ui_review"&&credits==before&&Snapshot()==snapshot,"PanCafe automatic bonus mode must block native credit before dispatch");Sql("UPDATE VARIABLES SET VVALUE='0' WHERE VNAME='mbr_bonus_active'");
                File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"integration-tests.json"),NativeBridge.Json.Serialize(new{success=true,assertions,starts,credits,polls,isolated_database=database,live_database_untouched=true,physical_hardware_tested=false}));
                Console.WriteLine("S TECH native bridge integration: "+assertions+" assertions passed. Restored database: "+database);return 0;
            }
            catch(Exception error){Console.Error.WriteLine(error);return 1;}
            finally{PanCafeNativeSessions.OpenBackend=original;}
        }
    }
}
