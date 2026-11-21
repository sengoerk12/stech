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
    static List<Dictionary<string,string>> Computers() {
        var rows = Query("SELECT T.ID,T.NAME,T.ISVIRTUAL,T.TERMINALSTATUS,T.NOMEMBERLOGIN,T.MAC,(SELECT CASE WHEN COUNT(*)=1 THEN MAX(M.USERNAME) ELSE NULL END FROM MEMBERS M WHERE M.ID=T.MEMBERID AND T.TERMINALSTATUS=5) AS SESSION_USERNAME FROM TERMINALS T WHERE T.TERMINALTYPE=0 ORDER BY T.ID");
        var connected = PanCafeConnectedTerminals.Read(database);
        var reserved = PanCafeNativeSessions.ReservedTerminals(folder);
        foreach (var row in rows) {
            bool isReserved = reserved.Contains(Int32.Parse(row["ID"]));
            row["RESERVED"] = isReserved ? "1" : "0";
            bool physicalOnline = row["ISVIRTUAL"] == "0" && connected.Contains(row["NAME"]);
            row["ONLINE"] = row["ISVIRTUAL"] == "1" || physicalOnline ? "1" : "0";
            bool allowed = Enabled("allowVirtualSessionStart");
            bool canWake = !isReserved && allowed && row["ISVIRTUAL"] == "0" && !physicalOnline &&
                row["NOMEMBERLOGIN"] == "0" && (row["TERMINALSTATUS"] == "0" || row["TERMINALSTATUS"] == "1") &&
                PanCafeConnectedTerminals.WakePacket(PanCafeConnectedTerminals.WakeAddress(database, row["NAME"], row["MAC"])) != null;
            row["WAKABLE"] = canWake ? "1" : "0";
            row["STARTSUPPORTED"] = !isReserved && allowed &&
                (row["ISVIRTUAL"] == "1" || ((physicalOnline || canWake) && row["NOMEMBERLOGIN"] == "0")) ? "1" : "0";
            if (row["ONLINE"] == "0" && row["TERMINALSTATUS"] == "1" && !canWake) row["TERMINALSTATUS"] = "0";
            row.Remove("MAC");
            row.Remove("NOMEMBERLOGIN");
        }
        return rows;
    }
    static JavaScriptSerializer Serializer() {return new JavaScriptSerializer { MaxJsonLength=1048576 };}
    static string Setting(string key) {return Convert.ToString(config[key]);}
    static bool Enabled(string key) {return config.ContainsKey(key) && Convert.ToBoolean(config[key]);}
    static bool FirebaseBalanceWriteEnabled() {return Enabled("allowFirebaseSync") && Enabled("allowFirebaseBalanceWrite");}
    static bool AllowedUser(string username) {return Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z");}
    static bool EqualSecret(string a,string b) {
        byte[] left=Encoding.UTF8.GetBytes(a ?? ""),right=Encoding.UTF8.GetBytes(b ?? "");
        int diff=left.Length^right.Length;
        for(int i=0;i<Math.Max(left.Length,right.Length);i++) diff|=(i<left.Length?left[i]:0)^(i<right.Length?right[i]:0);
        Array.Clear(left,0,left.Length);Array.Clear(right,0,right.Length);return diff==0;
    }
    static List<Dictionary<string,string>> Query(string sql) {return PanCafeReadOnly.Query(database,clientDirectory,sql);}
    static string PhoneDigits(string column) {
        return "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE("+column+",''),' ',''),'-',''),'(',''),')',''),'+',''),'.','')";
    }
    static string FirebaseColumn(string key,string pattern) {
        string name=Setting(key).Trim().ToUpperInvariant();
        if(!Regex.IsMatch(name,pattern)) throw new InvalidOperationException("Invalid Firebase member column");
        return name;
    }
    static List<Dictionary<string,string>> MemberByName(string username,bool withPassword) {
        if(!AllowedUser(username)) return new List<Dictionary<string,string>>();
        return Query("SELECT FIRST 2 "+projection+(withPassword?",PASSWORD":"")+" FROM MEMBERS WHERE LOWER(USERNAME)='"+username.ToLowerInvariant()+"'");
    }
    static List<Dictionary<string,string>> MemberById(int id) {
        return Query("SELECT FIRST 2 "+projection+" FROM MEMBERS WHERE ID="+id);
    }
    static void VerifyDatabase() { Query("SELECT FIRST 1 ID FROM MEMBERS"); }
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
            if(request.HttpMethod=="GET" && route=="/profile") {
                int id;if(!Int32.TryParse(request.QueryString["id"],out id)){Reply(response,400,new {error="invalid_member"});return;}
                Reply(response,200,PanCafeProfileWriter.Read(database,clientDirectory,id,request.QueryString["username"],apiKey));return;
            }
            if(request.HttpMethod=="POST" && route=="/profile/update") {
                var body=ReadBody(request);int id;if(!Int32.TryParse(Field(body,"memberId"),out id)){Reply(response,400,new {error="invalid_member"});return;}
                Reply(response,200,PanCafeProfileWriter.Update(database,clientDirectory,id,Field(body,"username"),Field(body,"firstName").Trim(),Field(body,"lastName").Trim(),Field(body,"phone"),Field(body,"address"),Field(body,"currentPassword"),Field(body,"newPassword"),Field(body,"revision"),Field(body,"operationId"),Field(body,"requestHash"),apiKey,Field(body,"cardUid").Trim().ToUpperInvariant()));return;
            }
            if(request.HttpMethod=="GET" && route=="/capabilities") {
                Reply(response,200,new[]{new Dictionary<string,string>{{"ADMIN_ADJUSTMENTS",Enabled("allowAdminAdjustments")?"true":"false"},{"FIREBASE_BALANCE_WRITE",FirebaseBalanceWriteEnabled()?"true":"false"},{"MEMBER_LIST","true"},{"MEMBER_SEARCH_FIELDS","true"}}});return;
            }
            if(request.HttpMethod=="GET" && route=="/health") {
                VerifyDatabase();
                Reply(response,200,new {connected=true,installationId=Setting("installationId"),name=Setting("displayName"),memberRegistration=Convert.ToBoolean(config["allowRegistration"]),balanceCredit=config.ContainsKey("allowBalanceCredit") && Convert.ToBoolean(config["allowBalanceCredit"]),transactionHistory=true,sessionHistory=true});return;
            }
            if(request.HttpMethod=="GET" && route=="/pc-availability") {
                var computers = Computers();
                int available = computers.FindAll(row => row["RESERVED"] != "1" &&
                    (row["TERMINALSTATUS"] == "1" || row["WAKABLE"] == "1")).Count;
                Reply(response,200,new [] {new {TOTAL=computers.Count.ToString(),AVAILABLE=available.ToString()}});return;
            }
            if(request.HttpMethod=="GET" && route=="/computers") {
                Reply(response,200,Computers());return;
            }
            if(request.HttpMethod=="POST" && route=="/sessions/start") {
                if(!Enabled("allowVirtualSessionStart")) {Reply(response,503,new {error="session_start_disabled"});return;}
                var body=ReadBody(request);int terminalId,memberId;
                if(!Int32.TryParse(Field(body,"terminalId"),out terminalId)||!Int32.TryParse(Field(body,"memberId"),out memberId)) {Reply(response,400,new {error="invalid_session"});return;}
                string username = Field(body,"username"), operationId = Field(body,"operationId");
                // Keep native UI work separate from bridge payments and reads.
                ThreadPool.QueueUserWorkItem(delegate {
                    try { Reply(response,200,PanCafeNativeSessions.Start(database,clientDirectory,folder,terminalId,memberId,username,operationId)); }
                    catch { try { Reply(response,503,new {error="pancafe_unavailable"}); } catch {} }
                });
                return;
            }
            if(request.HttpMethod=="GET" && route=="/sessions/status") {
                int terminalId,memberId;
                if(!Int32.TryParse(request.QueryString["terminalId"],out terminalId)||!Int32.TryParse(request.QueryString["memberId"],out memberId)) {Reply(response,400,new {error="invalid_session"});return;}
                Reply(response,200,PanCafeNativeSessions.Status(database,clientDirectory,folder,terminalId,memberId,request.QueryString["username"],request.QueryString["operationId"]));return;
            }
            if(request.HttpMethod=="GET" && route=="/admin/members") {
                int after;
                if(!Int32.TryParse(request.QueryString["after"]??"0",out after)||after<0) {Reply(response,400,new {error="invalid_search"});return;}
                string search=request.QueryString["search"]??"", field=request.QueryString["field"]??"username";
                string predicate=null;int memberId;
                if(field=="username" && Regex.IsMatch(search,@"\A[a-zA-Z0-9_.]{0,32}\z"))
                    predicate=search.Length==0 ? "1=1" : "USERNAME CONTAINING ?";
                else if(field=="number" && Regex.IsMatch(search,@"\A[1-9][0-9]{0,9}\z") && Int32.TryParse(search,out memberId))
                    predicate="ID=CAST(? AS INTEGER)";
                else if(field=="name" && Regex.IsMatch(search,@"\A[\p{L}\p{M} .'’\-]{1,65}\z"))
                    predicate="POSITION(CAST(? AS VARCHAR(65) CHARACTER SET UTF8) COLLATE UNICODE_CI_AI IN "+
                        "CAST(TRIM(COALESCE(NAME,''))||' '||TRIM(COALESCE(LASTNAME,'')) AS VARCHAR(65) CHARACTER SET UTF8) COLLATE UNICODE_CI_AI)>0";
                else if(field=="phone" && Regex.IsMatch(search,@"\A[0-9+().\s-]{3,32}\z")) {
                    search=Regex.Replace(search,"[^0-9]","");
                    if(search.Length==12 && search.StartsWith("90")) search=search.Substring(2);
                    else if(search.Length==11 && search.StartsWith("0")) search=search.Substring(1);
                    if(search.Length>=3) predicate="("+PhoneDigits("GSM")+" CONTAINING ? OR "+PhoneDigits("PHONE")+" CONTAINING ?)";
                }
                if(predicate==null) {Reply(response,400,new {error="invalid_search"});return;}
                string[] parameters=predicate=="1=1" ? null : field=="phone" ? new[]{search,search} : new[]{search};
                string sql="SELECT FIRST 101 "+projection+" FROM MEMBERS WHERE ID>"+after+" AND "+predicate+" ORDER BY ID";
                Reply(response,200,PanCafeReadOnly.Query(database,clientDirectory,sql,parameters));return;
            }
            if(request.HttpMethod=="GET" && route=="/firebase/members") {
                if(!config.ContainsKey("allowFirebaseSync") || !Convert.ToBoolean(config["allowFirebaseSync"])) {Reply(response,503,new {error="firebase_sync_disabled"});return;}
                int after;
                if(!Int32.TryParse(request.QueryString["after"],out after)||after<0) {Reply(response,400,new {error="invalid_cursor"});return;}
                string nationalId=config.ContainsKey("firebaseNationalIdColumn")
                    ? FirebaseColumn("firebaseNationalIdColumn",@"\A(?:TC|TCKN|TCKIMLIK|TC_KIMLIK|KIMLIK|NATIONAL_ID)(?:_?(?:NO|NUMARASI|NUMBER))?\z")
                    : "NULL";
                string address=FirebaseColumn("firebaseAddressColumn",@"\A(?:(?:EV_?)?ADRES(?:I)?|ADDRESS|ADRESS)(?:_?[1-9])?\z");
                Reply(response,200,Query("SELECT FIRST 100 ID,USERNAME,NAME,LASTNAME,GSM,EMAIL,ACCSTATUS,"+
                    "CAST(COALESCE(BAKIYE,0) AS DECIMAL(18,2)) AS BALANCE_TL,CAST(COALESCE(AVAILBONUS,0) AS DECIMAL(18,2)) AS BONUS_TL,"+
                    "CAST("+nationalId+" AS VARCHAR(32)) AS NATIONAL_ID,CAST("+address+" AS VARCHAR(1000)) AS POSTAL_ADDRESS FROM MEMBERS WHERE ID>"+after+" ORDER BY ID"));return;
            }
            if(request.HttpMethod=="POST" && (route=="/admin/adjust" || route=="/firebase/adjust")) {
                bool firebase=route=="/firebase/adjust";
                if(firebase ? !FirebaseBalanceWriteEnabled() : !Enabled("allowAdminAdjustments")) {Reply(response,503,new {error=firebase?"firebase_balance_write_disabled":"admin_disabled"});return;}
                var body=ReadBody(request);int id;long delta,bonus=0,expected,expectedBonus;
                if(!Int32.TryParse(Field(body,"memberId"),out id)||!Int64.TryParse(Field(body,"delta"),out delta)||(!firebase && !Int64.TryParse(Field(body,"bonusDelta"),out bonus))||!Int64.TryParse(Field(body,"expectedBalance"),out expected)||!Int64.TryParse(Field(body,"expectedBonus"),out expectedBonus)) {Reply(response,400,new {error="invalid_adjustment"});return;}
                string reason=firebase?"Firestore balance edit":Field(body,"reason");
                Reply(response,200,PanCafeAdminWriter.Adjust(database,clientDirectory,id,Field(body,"username"),delta,bonus,expected,expectedBonus,reason,Field(body,"operationId")));return;
            }
            if(request.HttpMethod=="GET" && route=="/member") {
                int id;string username=request.QueryString["username"];
                if(!Int32.TryParse(request.QueryString["id"],out id)||id<1||(username!=null&&!AllowedUser(username))) {Reply(response,400,new {error="invalid_member"});return;}
                var rows=MemberById(id);
                if(rows.Count!=1 || (username!=null&&!String.Equals(rows[0]["USERNAME"],username,StringComparison.OrdinalIgnoreCase))) {Reply(response,404,new {error="member_not_found"});return;}
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
            if(request.HttpMethod=="POST" && route=="/card-member") {
                var body=ReadBody(request);string uid=Field(body,"cardUid").Trim().ToUpperInvariant();
                if(!Regex.IsMatch(uid,@"\A[A-Z0-9_-]{4,64}\z")) {Reply(response,400,new {error="invalid_card"});return;}
                // This installation stores reader IDs in LASTNAME. Preserve leading zeroes.
                // Read two rows before checking active status so duplicate IDs fail closed.
                var rows=Query("SELECT FIRST 2 "+projection+" FROM MEMBERS M WHERE UPPER(TRIM(LASTNAME))='"+uid+"' OR EXISTS(SELECT 1 FROM STECH_MEMBER_CARDS C WHERE C.MEMBERID=M.ID AND C.USERNAME=M.USERNAME AND C.CARDUID='"+uid+"')");
                if(rows.Count!=1 || rows[0]["ACCSTATUS"]!="1") {Reply(response,401,new {error="unknown_or_ambiguous_card"});return;}
                Reply(response,200,rows);return;
            }
            if(request.HttpMethod=="POST" && route=="/register") {
                if(!Convert.ToBoolean(config["allowRegistration"])) {Reply(response,503,new {error="registration_pending_verification"});return;}
                var body=ReadBody(request);string username=Field(body,"username").Trim().ToLowerInvariant(),password=Field(body,"password"),name=Field(body,"name").Trim(),phone=Field(body,"phone").Trim(),email=Field(body,"email").Trim();
                string[] names=name.Split(new char[]{' '},2,StringSplitOptions.RemoveEmptyEntries);
                string first=names.Length>0?names[0]:"",last=names.Length>1?names[1]:"";
                if(body.ContainsKey("firstName") && body.ContainsKey("lastName")){first=Field(body,"firstName").Trim();last=Field(body,"lastName").Trim();}
                if(!AllowedUser(username)||username.Length<3||password.Length<8||password.Length>32||first.Length==0||first.Length>32||last.Length>32||phone.Length>20||email.Length>50) {Reply(response,400,new {error="invalid_registration"});return;}
                if(MemberByName(username,false).Count!=0) {Reply(response,409,new {error="username_taken"});return;}
                PanCafeMemberWriter.Create(database,clientDirectory,new string[]{username,password,first,last,phone,email});
                Reply(response,201,MemberByName(username,false));return;
            }
            if(request.HttpMethod=="GET" && route=="/credit/readiness") {
                bool ready=Enabled("allowBalanceCredit") && PanCafeBalanceWriter.AutoMemberBonusDisabled(database,clientDirectory);
                Reply(response,200,new[]{new Dictionary<string,string>{{"READY",ready?"true":"false"}}});return;
            }
            if(request.HttpMethod=="POST" && route=="/tickets/redeem") {
                if(!Enabled("allowBalanceCredit")) {Reply(response,503,new {error="credit_disabled"});return;}
                var body=ReadBody(request);
                int memberId;
                string barcode=Field(body,"barcode"), username=Field(body,"username");
                if(!Int32.TryParse(Field(body,"memberId"),out memberId)||!AllowedUser(username)||
                    !Regex.IsMatch(barcode,@"\A[0-9]{10}\z")) {Reply(response,400,new {error="invalid_ticket"});return;}
                ThreadPool.QueueUserWorkItem(delegate {
                    try {Reply(response,200,PanCafeNativeSessions.RedeemTicket(database,clientDirectory,memberId,username,barcode,folder));}
                    catch {try {Reply(response,503,new {error="pancafe_ticket_unavailable"});} catch {}}
                });
                return;
            }
            if(request.HttpMethod=="POST" && route=="/credit") {
                if(!config.ContainsKey("allowBalanceCredit") || !Convert.ToBoolean(config["allowBalanceCredit"])) {Reply(response,503,new {error="credit_disabled"});return;}
                var body=ReadBody(request);int memberId;long amount,bonus;
                if(!Int32.TryParse(Field(body,"memberId"),out memberId)||!Int64.TryParse(Field(body,"amount"),out amount)||!Int64.TryParse(Field(body,"bonus"),out bonus)) {Reply(response,400,new {error="invalid_credit"});return;}
                string username=Field(body,"username"), operationId=Field(body,"operationId");
                bool retryUnconfirmed=body.ContainsKey("retryUnconfirmed") && Object.Equals(body["retryUnconfirmed"], true);
                ThreadPool.QueueUserWorkItem(delegate {
                    try { Reply(response,200,PanCafeNativeSessions.Credit(database,clientDirectory,folder,memberId,username,amount,bonus,operationId,retryUnconfirmed)); }
                    catch { try { Reply(response,503,new {error="pancafe_credit_unavailable"}); } catch {} }
                });
                return;
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
            if(apiKey.Length<40 || !File.Exists(database)) throw new InvalidOperationException("Invalid configuration");
            VerifyDatabase();
            if(Enabled("verifyExpectedUsername")) {
                var rows=MemberByName(Setting("expectedUsername"),false);
                if(rows.Count!=1 || rows[0]["ID"]!=Setting("expectedMemberId"))
                    throw new InvalidOperationException("Member number and username do not match");
                config.Remove("verifyExpectedUsername");
                string pending=Path.Combine(folder,"connection.json.pending");
                File.WriteAllText(pending,Serializer().Serialize(config),new UTF8Encoding(false));
                File.Replace(pending,Path.Combine(folder,"connection.json"),null);
            }
            int port=config.ContainsKey("port")?Convert.ToInt32(config["port"]):3002;
            if(port!=3002 && port!=3003 && port!=3004) throw new InvalidOperationException("Invalid loopback port");
            if(Enabled("allowBalanceCredit")) {
                PanCafeBalanceWriter.Initialize(database,clientDirectory);
                PanCafeNativeSessions.InitializeTickets(database,clientDirectory);
            }
            if(Enabled("allowAdminAdjustments") || FirebaseBalanceWriteEnabled()) PanCafeAdminWriter.Initialize(database,clientDirectory);
            PanCafeProfileWriter.Initialize(database,clientDirectory);
            listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:"+port+"/");listener.Start();Status(true);
            ThreadPool.QueueUserWorkItem(delegate{Serve();});
            Application.EnableVisualStyles();
            var form=new Form {Text="S TECH - PanCafe bağlantısı",Width=500,Height=320,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
            form.Controls.Add(new Label {Left=24,Top=24,Width=410,Height=120,Text=Setting("displayName")+" bağlantısı hazır.\n\nPanCafe üyeleri ve bakiyeleri kullanılabilir.\n"+(config.ContainsKey("allowBalanceCredit") && Convert.ToBoolean(config["allowBalanceCredit"])?"Test ödemeleri PanCafe bakiyesine işlenir.":"Para yükleme etkin değildir.")+"\nBu pencereyi kapattığında bağlantı durur."});
            var adminAccess=new CheckBox {Text="Yönetim panelinin bakiye düzenlemesine izin ver",Left=24,Top=150,Width=440,Height=32,Checked=config.ContainsKey("allowAdminAdjustments") && Convert.ToBoolean(config["allowAdminAdjustments"])};
            adminAccess.CheckedChanged+=delegate {
                try {
                    if(adminAccess.Checked) PanCafeAdminWriter.Initialize(database,clientDirectory);
                    config["allowAdminAdjustments"]=adminAccess.Checked;
                    File.WriteAllText(Path.Combine(folder,"connection.json"),Serializer().Serialize(config),new UTF8Encoding(false));
                } catch {config["allowAdminAdjustments"]=false;adminAccess.Checked=false;MessageBox.Show("Yönetici erişimi kaydedilemedi.","S TECH");}
            };
            form.Controls.Add(adminAccess);
            var stop=new Button {Text="Bağlantıyı durdur",Left=24,Top=205,Width=180,Height=36};stop.Click+=delegate{form.Close();};form.Controls.Add(stop);
            Application.Run(form);listener.Close();Status(false);return 0;
        } catch(Exception error) {
            try{if(folder!=null)Status(false);}catch{}
            MessageBox.Show("PanCafe bağlantısı kurulamadı.\n\n"+error.Message,"S TECH bağlantı kontrolü",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
        }
    }
}
