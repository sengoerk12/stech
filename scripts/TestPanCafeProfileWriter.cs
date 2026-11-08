using System;
using System.IO;
public static class TestPanCafeProfileWriter {
 static void Expect(bool value,string text){if(!value)throw new Exception(text);}
 public static int Main(string[] args){
  var copy=Path.Combine(Path.GetTempPath(),"stech-profile-test-"+Guid.NewGuid().ToString("N")+".dat");
  try{
   File.Copy(args[0],copy);var client=args[1];var user="profile_"+Guid.NewGuid().ToString("N").Substring(0,8);var key=new string('x',48);
   PanCafeMemberWriter.Create(copy,client,new[]{user,"OriginalPass123!","Ali","00123456","05321234567",""});
   var id=Int32.Parse(PanCafeReadOnly.Query(copy,client,"SELECT ID FROM MEMBERS WHERE USERNAME='"+user+"'")[0]["ID"]);
   PanCafeProfileWriter.Initialize(copy,client);var p=PanCafeProfileWriter.Read(copy,client,id,user,key)[0];Expect(p["ID"]==id.ToString(),"Member number mismatch");Expect(!p.ContainsKey("PASSWORD"),"Password leaked");Expect(p["LASTNAME"]=="","Card UID exposed as surname");
   var op=Guid.NewGuid().ToString();var digest=new string('a',64);
   var result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Test adresi","OriginalPass123!","NewPassword123!",p["PROFILE_REVISION"],op,digest,key);
   Expect(result[0]["RESULT_CODE"]=="ok","Profile update failed");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Test adresi","OriginalPass123!","NewPassword123!",p["PROFILE_REVISION"],op,digest,key);Expect(result[0]["RESULT_CODE"]=="ok","Password retry failed");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Test adresi","OriginalPass123!","NewPassword123!",p["PROFILE_REVISION"],op,new string('b',64),key);Expect(result[0]["RESULT_CODE"]=="conflict","Conflicting receipt accepted");
   var after=PanCafeProfileWriter.Read(copy,client,id,user,key)[0];Expect(after["NAME"]=="Ali Can"&&after["LASTNAME"]=="Şengör"&&after["ADDRESS"]=="Test adresi","Profile values mismatch");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT CARDUID FROM STECH_MEMBER_CARDS WHERE MEMBERID="+id)[0]["CARDUID"]=="00123456","NFC binding lost");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT PASSWORD,CAST(BAKIYE AS DECIMAL(18,2)) AS B FROM MEMBERS WHERE ID="+id)[0]["PASSWORD"]=="NewPassword123!","Password not changed");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali","Test","+905321234567","Test","WrongPass123!","",after["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('b',64),key);Expect(result[0]["RESULT_CODE"]=="credentials","Wrong password accepted");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali","Test","+905321234567","Test","NewPassword123!","",p["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('c',64),key);Expect(result[0]["RESULT_CODE"]=="stale","Stale revision accepted");
   PanCafeReadOnly.Write(copy,client,"ALTER TABLE MEMBERS ADD CONSTRAINT STECH_PROFILE_FAIL CHECK(NAME <> 'Rollback')",null);bool rollback=false;
   try{PanCafeProfileWriter.Update(copy,client,id,user,"Rollback","Test","+905321234567","Broken","NewPassword123!","AnotherPass123!",after["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('d',64),key);}catch{rollback=true;}Expect(rollback,"Rollback test did not fail");
   var untouched=PanCafeReadOnly.Query(copy,client,"SELECT NAME,PASSWORD,CAST(BAKIYE AS DECIMAL(18,2)) AS B FROM MEMBERS WHERE ID="+id)[0];Expect(untouched["NAME"]=="Ali Can"&&untouched["PASSWORD"]=="NewPassword123!"&&untouched["B"]=="0.00","Rollback or balance preservation failed");
   var cardProfile=PanCafeProfileWriter.Read(copy,client,id,user,key)[0];
   var cardOp=Guid.NewGuid().ToString();
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Card test address","","CardPassword123!",cardProfile["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('e',64),key,"99999999");Expect(result[0]["RESULT_CODE"]=="credentials","Wrong card accepted");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Card test address","","CardPassword123!",cardProfile["PROFILE_REVISION"],cardOp,new string('f',64),key,"00123456");Expect(result[0]["RESULT_CODE"]=="ok","Linked card could not change password");
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Card test address","","CardPassword123!",cardProfile["PROFILE_REVISION"],cardOp,new string('f',64),key,"00123456");Expect(result[0]["RESULT_CODE"]=="ok","Card retry failed");
   PanCafeMemberWriter.Create(copy,client,new[]{user+"x","OtherPass123!","Other","00123456","05331234567",""});
   var duplicateProfile=PanCafeProfileWriter.Read(copy,client,id,user,key)[0];
   result=PanCafeProfileWriter.Update(copy,client,id,user,"Ali Can","Şengör","+905321234567","Must not update","","",duplicateProfile["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('a',64),key,"00123456");Expect(result[0]["RESULT_CODE"]=="credentials","Ambiguous card accepted");
   var alphaUser=user+"y";
   PanCafeMemberWriter.Create(copy,client,new[]{alphaUser,"AlphaPass123!","Alpha","RFID_ALPHA","05331234567",""});
   var alphaId=Int32.Parse(PanCafeReadOnly.Query(copy,client,"SELECT ID FROM MEMBERS WHERE USERNAME='"+alphaUser+"'")[0]["ID"]);
   var alphaProfile=PanCafeProfileWriter.Read(copy,client,alphaId,alphaUser,key)[0];
   result=PanCafeProfileWriter.Update(copy,client,alphaId,alphaUser,"Alpha","Surname","+905331234567","Address","","",alphaProfile["PROFILE_REVISION"],Guid.NewGuid().ToString(),new string('b',64),key,"RFID_ALPHA");Expect(result[0]["RESULT_CODE"]=="ok","Prefixed reader card rejected");
   Expect(PanCafeReadOnly.Query(copy,client,"SELECT CARDUID FROM STECH_MEMBER_CARDS WHERE MEMBERID="+alphaId)[0]["CARDUID"]=="RFID_ALPHA","Prefixed reader mapping lost");
   Console.WriteLine("PASS: native profile identity, names/phone/address/password, idempotent password retry, NFC preservation, stale revision, current password and atomic rollback on isolated copy.");return 0;
  }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
 }
}
