using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

public static class PanCafeHistoryReader {
    public const int PageSize=100;
    public static List<Dictionary<string,string>> Sessions(string database,string clientDirectory,int memberId,string username,string before) {
        long cursor=0;
        if(memberId<1 || !Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z") ||
            (!String.IsNullOrEmpty(before) && (!Int64.TryParse(before,out cursor)||cursor<1))) throw new ArgumentException("Invalid session history request");
        string sql="SELECT FIRST 101 CAST(S.ID AS VARCHAR(30)) AS SESSION_ID,CAST(S.MEMBERID AS VARCHAR(30)) AS MEMBER_ID,M.USERNAME,"+
            "S.TERMINALNAME,CAST(S.STARTPOINT AS VARCHAR(30)) AS STARTED_AT,CAST(S.ENDPOINT AS VARCHAR(30)) AS ENDED_AT,"+
            "CAST(S.USINGMIN AS VARCHAR(30)) AS DURATION_MINUTES,CAST(S.USINGPRICE AS DECIMAL(18,2)) AS USAGE_AMOUNT_TL"+
            " FROM SESSIONS S JOIN MEMBERS M ON M.ID=S.MEMBERID WHERE M.ID="+memberId.ToString(CultureInfo.InvariantCulture)+
            " AND M.USERNAME='"+username+"' AND M.ACCSTATUS=1 AND S.STARTPOINT>=M.RECDATE AND S.ENDPOINT IS NOT NULL"+
            (cursor>0?" AND S.ID<"+cursor.ToString(CultureInfo.InvariantCulture):"")+" ORDER BY S.ID DESC";
        return PanCafeReadOnly.Query(database,clientDirectory,sql);
    }
    public static List<Dictionary<string,string>> Read(string database,string clientDirectory,int memberId,string username,int beforeId) {
        if(memberId<1 || beforeId<0 || !Regex.IsMatch(username ?? "",@"\A[a-zA-Z0-9_.]{1,32}\z")) throw new ArgumentException("Invalid history request");
        var member=PanCafeReadOnly.Query(database,clientDirectory,"SELECT ID FROM MEMBERS WHERE ID="+memberId.ToString(CultureInfo.InvariantCulture)+" AND USERNAME='"+username+"' AND ACCSTATUS=1");
        if(member.Count!=1)throw new InvalidOperationException("History member mismatch");
        bool hasCredits=PanCafeReadOnly.Query(database,clientDirectory,"SELECT RDB$RELATION_NAME AS NAME FROM RDB$RELATIONS WHERE RDB$RELATION_NAME='STECH_MOBILE_CREDITS'").Count==1;
        string creditFields=hasCredits
            ? "C.OPID AS PAYMENT_ID,CAST(C.AMOUNT AS VARCHAR(30)) AS PAID_KURUS,CAST(C.BONUS AS VARCHAR(30)) AS BONUS_KURUS,CAST(C.BALANCEAFTER AS VARCHAR(30)) AS CREDIT_BALANCE_TL"
            : "CAST(NULL AS VARCHAR(36)) AS PAYMENT_ID,CAST(NULL AS VARCHAR(30)) AS PAID_KURUS,CAST(NULL AS VARCHAR(30)) AS BONUS_KURUS,CAST(NULL AS VARCHAR(30)) AS CREDIT_BALANCE_TL";
        string sql="SELECT FIRST 101 H.ID AS HISTORY_ID,H.MEMBERS_USERNAME AS USERNAME,"+
            "CAST(H.TARIH AS VARCHAR(30)) AS OCCURRED_DATE,CAST(H.SAAT AS VARCHAR(30)) AS OCCURRED_TIME,H.TERMINALNAME,H.NOTE,"+
            "CAST(H.MIKTAR AS DECIMAL(18,2)) AS RAW_AMOUNT_TL,CAST(H.KALAN AS DECIMAL(18,2)) AS BALANCE_TL,"+
            "(SELECT FIRST 1 CAST(P.KALAN AS DECIMAL(18,2)) FROM MEMBERSHISTORY P WHERE P.MEMBERS_USERNAME=H.MEMBERS_USERNAME AND P.ID<H.ID ORDER BY P.ID DESC) AS PREVIOUS_BALANCE_TL,"+
            creditFields+" FROM MEMBERSHISTORY H JOIN MEMBERS M ON M.USERNAME=H.MEMBERS_USERNAME"+
            (hasCredits?" LEFT JOIN STECH_MOBILE_CREDITS C ON C.USERNAME=H.MEMBERS_USERNAME AND C.MEMBERID=M.ID AND H.NOTE='S TECH test payment '||C.OPID":"")+
            " WHERE M.ID="+memberId.ToString(CultureInfo.InvariantCulture)+" AND M.USERNAME='"+username+"' AND H.TARIH>=M.RECDATE"+
            (beforeId>0?" AND H.ID<"+beforeId.ToString(CultureInfo.InvariantCulture):"")+" ORDER BY H.ID DESC";
        return PanCafeReadOnly.Query(database,clientDirectory,sql);
    }
}
