using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

// One Firebird transaction owns both the balance change and its idempotency receipt.
public static class PanCafeBalanceWriter {
    public static void Initialize(string database,string clientDirectory) {
        var rows=PanCafeReadOnly.Query(database,clientDirectory,"SELECT RDB$RELATION_NAME AS NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_MOBILE_CREDITS'");
        if(rows.Count==0) PanCafeReadOnly.Write(database,clientDirectory,
            "CREATE TABLE STECH_MOBILE_CREDITS (OPID VARCHAR(36) NOT NULL PRIMARY KEY, MEMBERID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL, AMOUNT BIGINT NOT NULL, BONUS BIGINT NOT NULL, BALANCEAFTER DECIMAL(18,2) NOT NULL, CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",null);
    }
    public static List<Dictionary<string,string>> Credit(string database,string clientDirectory,int memberId,string username,long amount,long bonus,string operationId) {
        Guid operation;
        if(memberId<1 || !Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z") ||
           !Guid.TryParse(operationId,out operation) || amount<5000 || amount>1000000 || bonus<0 || bonus>100000)
            throw new ArgumentException("Invalid credit request");
        string sql=@"EXECUTE BLOCK (P_OP VARCHAR(36)=?, P_ID INTEGER=?, P_USER VARCHAR(32)=?, P_AMOUNT BIGINT=?, P_BONUS BIGINT=?)
RETURNS (RESULT_CODE VARCHAR(12), BALANCE_TL DECIMAL(18,2)) AS
DECLARE N INTEGER;
DECLARE OLD_ID INTEGER;
DECLARE OLD_USER VARCHAR(32);
DECLARE OLD_AMOUNT BIGINT;
DECLARE OLD_BONUS BIGINT;
BEGIN
 SELECT COUNT(*) FROM STECH_MOBILE_CREDITS WHERE OPID=:P_OP INTO :N;
 IF (N>0) THEN BEGIN
  SELECT MEMBERID,USERNAME,AMOUNT,BONUS,BALANCEAFTER FROM STECH_MOBILE_CREDITS WHERE OPID=:P_OP
   INTO :OLD_ID,:OLD_USER,:OLD_AMOUNT,:OLD_BONUS,:BALANCE_TL;
  IF (OLD_ID=:P_ID AND OLD_USER=:P_USER AND OLD_AMOUNT=:P_AMOUNT AND OLD_BONUS=:P_BONUS) THEN RESULT_CODE='ok';
  ELSE RESULT_CODE='conflict';
  SUSPEND; EXIT;
 END
 UPDATE MEMBERS SET BAKIYE=CAST(COALESCE(BAKIYE,0) AS DECIMAL(18,2))+(:P_AMOUNT+:P_BONUS)/CAST(100 AS DECIMAL(18,2)),
  AVAILBONUS=CAST(COALESCE(AVAILBONUS,0) AS DECIMAL(18,2))+:P_BONUS/CAST(100 AS DECIMAL(18,2))
  WHERE ID=:P_ID AND USERNAME=:P_USER AND ACCSTATUS=1;
 IF (ROW_COUNT<>1) THEN BEGIN RESULT_CODE='missing'; SUSPEND; EXIT; END
 SELECT CAST(BAKIYE AS DECIMAL(18,2)) FROM MEMBERS WHERE ID=:P_ID AND USERNAME=:P_USER INTO :BALANCE_TL;
 INSERT INTO STECH_MOBILE_CREDITS(OPID,MEMBERID,USERNAME,AMOUNT,BONUS,BALANCEAFTER)
  VALUES(:P_OP,:P_ID,:P_USER,:P_AMOUNT,:P_BONUS,:BALANCE_TL);
 INSERT INTO MEMBERSHISTORY(MEMBERS_USERNAME,TERMINALNAME,MIKTAR,KALAN,NOTE)
  VALUES(:P_USER,'S TECH Mobile',(:P_AMOUNT+:P_BONUS)/CAST(100 AS DECIMAL(18,2)),:BALANCE_TL,'S TECH test payment '||:P_OP);
 RESULT_CODE='ok'; SUSPEND;
END";
        var result=PanCafeReadOnly.Write(database,clientDirectory,sql,new string[]{operation.ToString(),memberId.ToString(CultureInfo.InvariantCulture),username,amount.ToString(CultureInfo.InvariantCulture),bonus.ToString(CultureInfo.InvariantCulture)});
        if(result.Count!=1 || result[0]["RESULT_CODE"]!="ok") throw new InvalidOperationException("Credit identity or operation conflict");
        return result;
    }
}
