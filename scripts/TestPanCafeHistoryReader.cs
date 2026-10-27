using System;
using System.IO;
public static class TestPanCafeHistoryReader {
    static void Expect(bool value,string message){if(!value)throw new Exception(message);}
    public static int Main(string[] args) {
        string copy=Path.Combine(Path.GetTempPath(),"stech-history-test-"+Guid.NewGuid().ToString("N")+".dat");
        try {
            File.Copy(args[0],copy);string client=args[1];
            var native=PanCafeHistoryReader.Read(copy,client,1,"kaans",0);
            Expect(native.Count>=3,"Expected inspected native cashier records");
            Expect(native[0]["PAYMENT_ID"]=="a8544b1a-34a8-46b2-8364-0002be2d3b4e" && native[0]["PAID_KURUS"]=="20000" && native[0]["BONUS_KURUS"]=="2000","Mobile receipt join failed");
            Expect(native[1]["RAW_AMOUNT_TL"]=="100.00" && native[1]["PREVIOUS_BALANCE_TL"]=="100.00","Cashier or previous balance mismatch");
            bool mismatch=false;try{PanCafeHistoryReader.Read(copy,client,2,"kaans",0);}catch{mismatch=true;}
            Expect(mismatch,"Wrong member identity accepted");
            string username="st_hist_"+Guid.NewGuid().ToString("N").Substring(0,8);
            PanCafeMemberWriter.Create(copy,client,new string[]{username,"HistoryTest123!","Test","History","",""});
            int id=Int32.Parse(PanCafeReadOnly.Query(copy,client,"SELECT ID FROM MEMBERS WHERE USERNAME='"+username+"'")[0]["ID"]);
            PanCafeReadOnly.Write(copy,client,"EXECUTE BLOCK AS DECLARE N INTEGER; BEGIN N=1; WHILE (N<=120) DO BEGIN INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,MIKTAR,KALAN,NOTE) VALUES('"+username+"',1,:N,'history fixture'); N=N+1; END END",null);
            var first=PanCafeHistoryReader.Read(copy,client,id,username,0);
            Expect(first.Count==101,"Native page bound failed");
            var second=PanCafeHistoryReader.Read(copy,client,id,username,Int32.Parse(first[99]["HISTORY_ID"]));
            Expect(second.Count==20,"Older page incomplete");
            Expect(Int32.Parse(second[0]["HISTORY_ID"])<Int32.Parse(first[99]["HISTORY_ID"]),"Cursor duplicated boundary");
            PanCafeReadOnly.Write(copy,client,"INSERT INTO SESSIONS(ID,ADMINID,ADMINNAME,TERMINALNAME,MEMBERID,STARTPOINT,ENDPOINT,USINGMIN,USINGPRICE) VALUES(900001,0,'Test','PC 27',"+id+",CAST(CURRENT_DATE AS TIMESTAMP),DATEADD(10 MINUTE TO CAST(CURRENT_DATE AS TIMESTAMP)),10,25)",null);
            var sessions=PanCafeHistoryReader.Sessions(copy,client,id,username,null);
            Expect(sessions.Count==1 && sessions[0]["MEMBER_ID"]==id.ToString() && sessions[0]["USAGE_AMOUNT_TL"]=="25.00" && sessions[0]["DURATION_MINUTES"]=="10","Native completed session projection failed");
            Expect(PanCafeHistoryReader.Sessions(copy,client,1,"kaans",null).Count==0,"Session crossed member boundary");
            Expect(PanCafeHistoryReader.Sessions(copy,client,id,username,"900001").Count==0,"Session cursor repeated row");
            Console.WriteLine("Isolated copy: real cashier history, mobile receipt join, member isolation and 120-record pagination passed.");return 0;
        }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
