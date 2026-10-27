using System;
using System.IO;
using System.Text;
public static class TestPanCafeMemberWriter
{
    public static int Main(string[] args) {
        string copy=Path.Combine(Path.GetTempPath(),"stech-pancafe-write-test-"+Guid.NewGuid().ToString("N")+".dat");
        try {
            File.Copy(args[0],copy);
            string name="st_test_"+Guid.NewGuid().ToString("N").Substring(0,8);
            string password="FixturePass2026!";
            PanCafeMemberWriter.Create(copy,args[1],new string[]{name,password,"Çağrı","Şengör","",""});
            var rows=PanCafeReadOnly.Query(copy,args[1],"SELECT ID,USERNAME,PASSWORD,NAME,LASTNAME,CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE FROM MEMBERS WHERE USERNAME='"+name+"'");
            if(rows.Count!=1 || rows[0]["PASSWORD"]!=password || rows[0]["BALANCE"]!="0.00" || rows[0]["NAME"]!="Çağrı" || rows[0]["LASTNAME"]!="Şengör") throw new Exception("Created member does not match input.");
            bool duplicate=false;
            try {PanCafeMemberWriter.Create(copy,args[1],new string[]{name,"DifferentPass!","","","",""});}catch{duplicate=true;}
            if(!duplicate)throw new Exception("Duplicate username accepted.");
            rows=PanCafeReadOnly.Query(copy,args[1],"SELECT PASSWORD FROM MEMBERS WHERE USERNAME='"+name+"'");
            if(rows[0]["PASSWORD"]!=password)throw new Exception("Existing password changed.");
            string invalidName=name+"_bad";
            bool rejected=false;
            try{PanCafeMemberWriter.Create(copy,args[1],new string[]{invalidName,password,"Name","","",new string('x',100)});}catch{rejected=true;}
            if(!rejected || PanCafeReadOnly.Query(copy,args[1],"SELECT ID FROM MEMBERS WHERE USERNAME='"+invalidName+"'").Count!=0)throw new Exception("Failed registration did not roll back.");
            Console.WriteLine("Isolated database copy: new member, same password, UTF8, zero balance, duplicate protection and rollback passed.");
            return 0;
        }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
}
