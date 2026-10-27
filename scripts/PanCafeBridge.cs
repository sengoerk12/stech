using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Explicitly started by the operator. Loopback only, authenticated, no arbitrary SQL endpoint.
public static class PanCafeBridge
{
    static Dictionary<string,object> config;
    static string database,clientDirectory,apiKey,folder;
    static HttpListener listener;
    const string projection="ID,USERNAME,NAME,LASTNAME,GSM,PHONE,EMAIL,CAST(RECDATE AS VARCHAR(30)) AS JOINED_AT,CAST(BAKIYE AS DECIMAL(18,2)) AS BALANCE_TL,CAST(AVAILBONUS AS DECIMAL(18,2)) AS BONUS_TL,ACCTYPE,ACCSTATUS";
    static JavaScriptSerializer Serializer() {return new JavaScriptSerializer { MaxJsonLength=1048576 };}
    static string Setting(string key) {return Convert.ToString(config[key]);}
    static bool AllowedUser(string username) {return Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z");}
    static bool EqualSecret(string a,string b) {
        byte[] left=Encoding.UTF8.GetBytes(a ?? ""),right=Encoding.UTF8.GetBytes(b ?? "");
        int diff=left.Length^right.Length;
        for(int i=0;i<Math.Max(left.Length,right.Length);i++) diff|=(i<left.Length?left[i]:0)^(i<right.Length?right[i]:0);
        Array.Clear(left,0,left.Length);Array.Clear(right,0,right.Length);return diff==0;
    }
    static List<Dictionary<string,string>> Query(string sql) {return PanCafeReadOnly.Query(database,clientDirectory,sql);}
    static List<Dictionary<string,string>> MemberByName(string username,bool withPassword) {
        if(!AllowedUser(username)) return new List<Dictionary<string,string>>();
        return Query("SELECT FIRST 2 "+projection+(withPassword?",PASSWORD":"")+" FROM MEMBERS WHERE LOWER(USERNAME)='"+username.ToLowerInvariant()+"'");
    }
    static void Reply(HttpListenerResponse response,int code,object data) {
        byte[] bytes=Encoding.UTF8.GetBytes(Serializer().Serialize(data));response.StatusCode=code;
        response.ContentType="application/json; charset=utf-8";response.Headers["Cache-Control"]="no-store";
        response.ContentLength64=bytes.Length;response.OutputStream.Write(bytes,0,bytes.Length);response.Close();
    }
    static Dictionary<string,object> ReadBody(HttpListenerRequest request) {
        if(request.ContentLength64<0 || request.ContentLength64>8192) throw new ArgumentException("Invalid request size");
        using(var reader=new StreamReader(request.InputStream,Encoding.UTF8)) return Serializer().Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
    }
    static string Field(Dictionary<string,object> body,string field) {return body.ContainsKey(field)?Convert.ToString(body[field]):"";}
    static void Handle(HttpListenerContext context) {
        var request=context.Request;var response=context.Response;
        try {
            if(!EqualSecret(request.Headers["Authorization"],"Bearer "+apiKey)) {Reply(response,401,new {error="unauthorized"});return;}
            string route=request.Url.AbsolutePath;
            if(request.HttpMethod=="GET" && route=="/health") {
                var check=MemberByName(Setting("expectedUsername"),false);
                if(check.Count!=1 || check[0]["ID"]!=Setting("expectedMemberId")) throw new InvalidOperationException("Configured member mismatch");
                Reply(response,200,new {connected=true,installationId=Setting("installationId"),name=Setting("displayName"),memberRegistration=Convert.ToBoolean(config["allowRegistration"]),balanceCredit=config.ContainsKey("allowBalanceCredit") && Convert.ToBoolean(config["allowBalanceCredit"]),transactionHistory=true,sessionHistory=true});return;
            }
            if(request.HttpMethod=="GET" && route=="/member") {
                int id;string username=request.QueryString["username"];
                if(!Int32.TryParse(request.QueryString["id"],out id)||id<1||!AllowedUser(username)) {Reply(response,400,new {error="invalid_member"});return;}
                var rows=MemberByName(username,false);
                if(rows.Count!=1 || rows[0]["ID"]!=id.ToString()) {Reply(response,404,new {error="member_not_found"});return;}
                Reply(response,200,rows);return;
            }
            if(request.HttpMethod=="GET" && route=="/transactions") {
                int id,before=0;string username=request.QueryString["username"],cursor=request.QueryString["before"];
                if(!Int32.TryParse(request.QueryString["id"],out id)||id<1||!AllowedUser(username)||
                   (cursor!=null && (!Int32.TryParse(cursor,out before)||before<1))) {Reply(response,400,new {error="invalid_history"});return;}
                Reply(response,200,PanCafeHistoryReader.Read(database,clientDirectory,id,username,before));return;
            }
            if(request.HttpMethod=="GET" && route=="/session-history") {
                int id;string username=request.QueryString["username"];
                if(!Int32.TryParse(request.QueryString["id"],out id)||id<1||!AllowedUser(username)) {Reply(response,400,new {error="invalid_session_history"});return;}
                Reply(response,200,PanCafeHistoryReader.Sessions(database,clientDirectory,id,username,request.QueryString["before"]));return;
            }
            if(request.HttpMethod=="POST" && route=="/authenticate") {
                var body=ReadBody(request);string username=Field(body,"identifier"),password=Field(body,"password");
                var rows=MemberByName(username,true);
                if(rows.Count!=1 || password.Length>32 || !EqualSecret(rows[0]["PASSWORD"],password) || rows[0]["ACCSTATUS"]!="1") {Reply(response,401,new {error="invalid_credentials"});return;}
                rows[0].Remove("PASSWORD");Reply(response,200,rows);return;
            }
            if(request.HttpMethod=="POST" && route=="/register") {
                if(!Convert.ToBoolean(config["allowRegistration"])) {Reply(response,503,new {error="registration_pending_verification"});return;}
                var body=ReadBody(request);string username=Field(body,"username").Trim().ToLowerInvariant(),password=Field(body,"password"),name=Field(body,"name").Trim(),phone=Field(body,"phone").Trim(),email=Field(body,"email").Trim();
                string[] names=name.Split(new char[]{' '},2,StringSplitOptions.RemoveEmptyEntries);
                string first=names.Length>0?names[0]:"",last=names.Length>1?names[1]:"";
                if(!AllowedUser(username)||username.Length<3||password.Length<8||password.Length>32||first.Length==0||first.Length>32||last.Length>32||phone.Length>20||email.Length>50) {Reply(response,400,new {error="invalid_registration"});return;}
                if(MemberByName(username,false).Count!=0) {Reply(response,409,new {error="username_taken"});return;}
                PanCafeMemberWriter.Create(database,clientDirectory,new string[]{username,password,first,last,phone,email});
                Reply(response,201,MemberByName(username,false));return;
            }
            if(request.HttpMethod=="POST" && route=="/credit") {
                if(!config.ContainsKey("allowBalanceCredit") || !Convert.ToBoolean(config["allowBalanceCredit"])) {Reply(response,503,new {error="credit_disabled"});return;}
                var body=ReadBody(request);int memberId;long amount,bonus;
                if(!Int32.TryParse(Field(body,"memberId"),out memberId)||!Int64.TryParse(Field(body,"amount"),out amount)||!Int64.TryParse(Field(body,"bonus"),out bonus)) {Reply(response,400,new {error="invalid_credit"});return;}
                Reply(response,200,PanCafeBalanceWriter.Credit(database,clientDirectory,memberId,Field(body,"username"),amount,bonus,Field(body,"operationId")));return;
            }
            Reply(response,404,new {error="not_found"});
        } catch {try{Reply(response,503,new {error="pancafe_unavailable"});}catch{}}
    }
    static void Serve() {while(listener.IsListening){try{Handle(listener.GetContext());}catch(HttpListenerException){break;}catch(ObjectDisposedException){break;}}}
    static void Status(bool connected) {File.WriteAllText(Path.Combine(folder,"status.json"),Serializer().Serialize(new {connected=connected,updatedAt=DateTime.UtcNow.ToString("o")}),new UTF8Encoding(false));}
    [STAThread] public static int Main(string[] args) {
        try {
            folder=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            config=Serializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(folder,"connection.json")));
            database=Setting("databasePath");clientDirectory=Setting("clientDirectory");apiKey=Setting("apiKey");
            if(apiKey.Length<40 || !File.Exists(database) || !AllowedUser(Setting("expectedUsername"))) throw new InvalidOperationException("Invalid configuration");
            var rows=MemberByName(Setting("expectedUsername"),false);
            if(rows.Count!=1 || rows[0]["ID"]!=Setting("expectedMemberId")) throw new InvalidOperationException("Member number and username do not match");
            int port=config.ContainsKey("port")?Convert.ToInt32(config["port"]):3002;
            if(port!=3002 && port!=3003) throw new InvalidOperationException("Invalid loopback port");
            if(config.ContainsKey("allowBalanceCredit") && Convert.ToBoolean(config["allowBalanceCredit"])) PanCafeBalanceWriter.Initialize(database,clientDirectory);
            listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:"+port+"/");listener.Start();Status(true);
            ThreadPool.QueueUserWorkItem(delegate{Serve();});
            Application.EnableVisualStyles();
            var form=new Form {Text="S TECH - PanCafe bağlantısı",Width=470,Height=260,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
            form.Controls.Add(new Label {Left=24,Top=24,Width=410,Height=120,Text=Setting("displayName")+" bağlantısı hazır.\n\nPanCafe üyeleri ve bakiyeleri kullanılabilir.\n"+(config.ContainsKey("allowBalanceCredit") && Convert.ToBoolean(config["allowBalanceCredit"])?"Test ödemeleri PanCafe bakiyesine işlenir.":"Para yükleme etkin değildir.")+"\nBu pencereyi kapattığında bağlantı durur."});
            var stop=new Button {Text="Bağlantıyı durdur",Left=24,Top=155,Width=180,Height=36};stop.Click+=delegate{form.Close();};form.Controls.Add(stop);
            Application.Run(form);listener.Close();Status(false);return 0;
        } catch(Exception error) {
            try{if(folder!=null)Status(false);}catch{}
            MessageBox.Show("PanCafe bağlantısı kurulamadı.\n\n"+error.Message,"S TECH bağlantı kontrolü",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
        }
    }
}
