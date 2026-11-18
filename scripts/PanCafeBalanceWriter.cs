using System;
using System.Text.RegularExpressions;

// Receipt storage shared by the native credit path and transaction history.
public static class PanCafeBalanceWriter {
    public static void Initialize(string database,string clientDirectory) {
        var rows=PanCafeReadOnly.Query(database,clientDirectory,"SELECT RDB$RELATION_NAME AS NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_MOBILE_CREDITS'");
        if(rows.Count==0) PanCafeReadOnly.Write(database,clientDirectory,
            "CREATE TABLE STECH_MOBILE_CREDITS (OPID VARCHAR(36) NOT NULL PRIMARY KEY, MEMBERID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL, AMOUNT BIGINT NOT NULL, BONUS BIGINT NOT NULL, BALANCEAFTER DECIMAL(18,2) NOT NULL, CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",null);
        var live=PanCafeReadOnly.Query(database,clientDirectory,"SELECT RDB$RELATION_NAME AS NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_LIVE_CREDIT_INTENTS'");
        if(live.Count==0) PanCafeReadOnly.Write(database,clientDirectory,
            "CREATE TABLE STECH_LIVE_CREDIT_INTENTS (OPID VARCHAR(36) NOT NULL PRIMARY KEY, MEMBERID INTEGER NOT NULL, USERNAME VARCHAR(32) NOT NULL, AMOUNT BIGINT NOT NULL, BONUS BIGINT NOT NULL, CREDIT_TOTAL BIGINT, CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",null);
        else if(PanCafeReadOnly.Query(database,clientDirectory,
            "SELECT RDB$FIELD_NAME AS NAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME='STECH_LIVE_CREDIT_INTENTS' AND RDB$FIELD_NAME='CREDIT_TOTAL'").Count==0)
            PanCafeReadOnly.Write(database,clientDirectory,"ALTER TABLE STECH_LIVE_CREDIT_INTENTS ADD CREDIT_TOTAL BIGINT",null);
    }
    internal static bool AutoMemberBonusDisabled(string database, string clientDirectory) {
        var settings = PanCafeReadOnly.Query(database, clientDirectory,
            "SELECT FIRST 2 VVALUE FROM VARIABLES WHERE VNAME='mbr_bonus_active'");
        return settings.Count == 1 && settings[0]["VVALUE"] == "0";
    }
    internal static Guid Validate(int memberId,string username,long amount,long bonus,string operationId) {
        Guid operation;
        if(memberId<1 || !Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z") ||
           !Guid.TryParse(operationId,out operation) || amount<100 || amount>1000000 || bonus<0 || bonus>100000)
            throw new ArgumentException("Invalid credit request");
        return operation;
    }
}
