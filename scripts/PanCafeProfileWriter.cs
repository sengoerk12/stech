using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public static class PanCafeProfileWriter {
 public static void Initialize(string db,string client) {
  if(PanCafeReadOnly.Query(db,client,"SELECT RDB$RELATION_NAME AS N FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_PROFILE_OPS'").Count==0)
   PanCafeReadOnly.Write(db,client,"CREATE TABLE STECH_PROFILE_OPS (OPID VARCHAR(36) NOT NULL PRIMARY KEY, MEMBERID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL, REQUESTHASH VARCHAR(64) NOT NULL, CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",null);
  if(PanCafeReadOnly.Query(db,client,"SELECT RDB$RELATION_NAME AS N FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_MEMBER_CARDS'").Count==0)
   PanCafeReadOnly.Write(db,client,"CREATE TABLE STECH_MEMBER_CARDS (MEMBERID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL, CARDUID VARCHAR(64) NOT NULL, PRIMARY KEY(MEMBERID,USERNAME,CARDUID))",null);
 }
 static void Identity(int id,string user){if(id<1||!Regex.IsMatch(user??"",@"\A[a-zA-Z0-9_.]{1,32}\z"))throw new ArgumentException("Invalid member");}
 static Dictionary<string,string> Raw(string db,string client,int id,string user,bool password) {
  Identity(id,user);
  var rows=PanCafeReadOnly.Query(db,client,"SELECT ID,USERNAME,NAME,LASTNAME,GSM,PHONE,ADDRESS,ACCSTATUS"+(password?",PASSWORD":"")+" FROM MEMBERS WHERE ID="+id.ToString(CultureInfo.InvariantCulture)+" AND USERNAME='"+user+"' AND ACCSTATUS=1");
  if(rows.Count!=1)throw new InvalidOperationException("Member mismatch");return rows[0];
 }
 static string Revision(Dictionary<string,string> row,string key) {
  var values=new List<string>();foreach(string field in new[]{"ID","USERNAME","NAME","LASTNAME","GSM","ADDRESS"})values.Add(row[field]??"");
  using(var h=new HMACSHA256(Encoding.UTF8.GetBytes(key)))return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(values)))).Replace("-","").ToLowerInvariant();
 }
 public static List<Dictionary<string,string>> Read(string db,string client,int id,string user,string key) {
  var row=Raw(db,client,id,user,false);row["PROFILE_REVISION"]=Revision(row,key);
  if(IsCard(row["LASTNAME"]))row["LASTNAME"]="";
  return new List<Dictionary<string,string>>{row};
 }
 static bool IsCard(string value){return Regex.IsMatch(value??"",@"\A[0-9A-Fa-f]{4,32}\z")&&Regex.IsMatch(value??"",@"[0-9]");}
 static List<Dictionary<string,string>> Result(string status){return new List<Dictionary<string,string>>{new Dictionary<string,string>{{"RESULT_CODE",status}}};}
 public static List<Dictionary<string,string>> Update(string db,string client,int id,string user,string first,string last,string phone,string address,string current,string next,string revision,string op,string hash,string key,string cardUid=""){
  Identity(id,user);Guid operation;
  if(!Guid.TryParse(op,out operation)||!Regex.IsMatch(hash??"",@"\A[a-f0-9]{64}\z")||!Regex.IsMatch(revision??"",@"\A[a-f0-9]{64}\z")||String.IsNullOrWhiteSpace(first)||first.Length>32||String.IsNullOrWhiteSpace(last)||last.Length>32||!Regex.IsMatch(phone??"",@"\A\+905[0-9]{9}\z")||address==null||address.Length>1024||current==null||current.Length>32||cardUid==null||(current.Length==0&&cardUid.Length==0)||(current.Length>0&&cardUid.Length>0)||(cardUid.Length>0&&!Regex.IsMatch(cardUid,@"\A[A-Z0-9_-]{4,64}\z"))||next==null||(next.Length>0&&(next.Length<8||next.Length>32)))throw new ArgumentException("Invalid profile");
  var receipt=PanCafeReadOnly.Query(db,client,"SELECT MEMBERID,USERNAME,REQUESTHASH FROM STECH_PROFILE_OPS WHERE OPID='"+operation.ToString()+"'");
  if(receipt.Count>0)return Result(receipt[0]["MEMBERID"]==id.ToString(CultureInfo.InvariantCulture)&&receipt[0]["USERNAME"]==user&&receipt[0]["REQUESTHASH"]==hash?"ok":"conflict");
  var old=Raw(db,client,id,user,true);
  if(cardUid.Length>0){
   var matches=PanCafeReadOnly.Query(db,client,"SELECT FIRST 2 ID,USERNAME,ACCSTATUS FROM MEMBERS M WHERE UPPER(TRIM(LASTNAME))='"+cardUid+"' OR EXISTS(SELECT 1 FROM STECH_MEMBER_CARDS C WHERE C.MEMBERID=M.ID AND C.USERNAME=M.USERNAME AND C.CARDUID='"+cardUid+"')");
   if(matches.Count!=1||matches[0]["ID"]!=id.ToString(CultureInfo.InvariantCulture)||matches[0]["USERNAME"]!=user||matches[0]["ACCSTATUS"]!="1")return Result("credentials");
   current=old["PASSWORD"]??"";
  }else if(old["PASSWORD"]!=current)return Result("credentials");
  if(Revision(old,key)!=revision)return Result("stale");
  string card=cardUid.Length>0?cardUid:(IsCard(old["LASTNAME"])?old["LASTNAME"].ToUpperInvariant():"");
  string sql=@"EXECUTE BLOCK(P_OP VARCHAR(36)=?,P_ID INTEGER=?,P_USER VARCHAR(32)=?,P_HASH VARCHAR(64)=?,P_FIRST VARCHAR(32)=?,P_LAST VARCHAR(32)=?,P_PHONE VARCHAR(20)=?,P_ADDRESS VARCHAR(1024)=?,P_CURRENT VARCHAR(32)=?,P_NEXT VARCHAR(32)=?,P_OLD_FIRST VARCHAR(32)=?,P_OLD_LAST VARCHAR(32)=?,P_OLD_PHONE VARCHAR(20)=?,P_OLD_ADDRESS VARCHAR(1024)=?,P_CARD VARCHAR(64)=?,P_AUTHUID VARCHAR(64)=?)
RETURNS(RESULT_CODE VARCHAR(12)) AS DECLARE N INTEGER;
BEGIN
 SELECT COUNT(*) FROM STECH_PROFILE_OPS WHERE OPID=:P_OP AND MEMBERID=:P_ID AND USERNAME=:P_USER AND REQUESTHASH=:P_HASH INTO :N;
 IF(N=1)THEN BEGIN RESULT_CODE='ok';SUSPEND;EXIT;END
 IF(P_AUTHUID<>'')THEN BEGIN
  SELECT COUNT(*) FROM MEMBERS M WHERE UPPER(TRIM(M.LASTNAME))=:P_AUTHUID OR EXISTS(SELECT 1 FROM STECH_MEMBER_CARDS C WHERE C.MEMBERID=M.ID AND C.USERNAME=M.USERNAME AND C.CARDUID=:P_AUTHUID) INTO :N;
  IF(N<>1 OR NOT EXISTS(SELECT 1 FROM MEMBERS M WHERE M.ID=:P_ID AND M.USERNAME=:P_USER AND M.ACCSTATUS=1 AND (UPPER(TRIM(M.LASTNAME))=:P_AUTHUID OR EXISTS(SELECT 1 FROM STECH_MEMBER_CARDS C WHERE C.MEMBERID=M.ID AND C.USERNAME=M.USERNAME AND C.CARDUID=:P_AUTHUID))))THEN BEGIN RESULT_CODE='credentials';SUSPEND;EXIT;END
 END
 UPDATE MEMBERS SET NAME=:P_FIRST,LASTNAME=:P_LAST,GSM=:P_PHONE,ADDRESS=:P_ADDRESS,PASSWORD=CASE WHEN :P_NEXT='' THEN PASSWORD ELSE :P_NEXT END
 WHERE ID=:P_ID AND USERNAME=:P_USER AND ACCSTATUS=1 AND COALESCE(PASSWORD,'')=:P_CURRENT AND COALESCE(NAME,'')=:P_OLD_FIRST AND COALESCE(LASTNAME,'')=:P_OLD_LAST AND COALESCE(GSM,'')=:P_OLD_PHONE AND COALESCE(ADDRESS,'')=:P_OLD_ADDRESS;
 IF(ROW_COUNT<>1)THEN BEGIN RESULT_CODE='stale';SUSPEND;EXIT;END
 IF(P_CARD<>'')THEN UPDATE OR INSERT INTO STECH_MEMBER_CARDS(MEMBERID,USERNAME,CARDUID) VALUES(:P_ID,:P_USER,:P_CARD) MATCHING(MEMBERID,USERNAME,CARDUID);
 INSERT INTO STECH_PROFILE_OPS(OPID,MEMBERID,USERNAME,REQUESTHASH) VALUES(:P_OP,:P_ID,:P_USER,:P_HASH);
 RESULT_CODE='ok';SUSPEND;
END";
  var result=PanCafeReadOnly.Write(db,client,sql,new[]{operation.ToString(),id.ToString(CultureInfo.InvariantCulture),user,hash,first,last,phone,address,current,next,old["NAME"]??"",old["LASTNAME"]??"",old["GSM"]??"",old["ADDRESS"]??"",card,cardUid});
  old.Remove("PASSWORD");return result;
 }
}
