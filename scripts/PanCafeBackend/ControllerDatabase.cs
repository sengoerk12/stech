using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static partial class FbDb
{
    internal static void InsertControllerRecord(string sql)
    {
        if(!sql.StartsWith("INSERT INTO MEMBERSHISTORY (",StringComparison.Ordinal)&&!sql.StartsWith("INSERT INTO KASAHAR (",StringComparison.Ordinal)&&!sql.StartsWith("INSERT INTO STECH_MOBILE_CREDITS (",StringComparison.Ordinal)&&!sql.StartsWith("INSERT INTO STECH_TICKET_CREDITS (",StringComparison.Ordinal))throw new ArgumentException("Unsupported backend statement.");
        byte[] bytes=Encoding.UTF8.GetBytes(sql);
        Check(isc_dsql_execute_immediate(Status,ref Db,ref Tr,(ushort)bytes.Length,bytes,3,IntPtr.Zero));
    }
}

namespace STech.PanCafeBackend
{
    internal sealed class CreditRequest
    {
        internal string OperationId;
        internal long PaidKurus,BonusKurus;
        internal int TicketId;
        internal string Barcode;
        internal void Validate(decimal amount)
        {
            Guid id;
            if(TicketId>0)
            {
                if(String.IsNullOrEmpty(Barcode)||!System.Text.RegularExpressions.Regex.IsMatch(Barcode,@"\A[0-9]{10}\z")||BonusKurus!=0||PaidKurus<=0||amount!=PaidKurus/100m)throw new ArgumentException("Invalid ticket credit.");
                return;
            }
            if(!Guid.TryParse(OperationId,out id)||id.ToString()!=OperationId||PaidKurus<100||PaidKurus>1000000||BonusKurus<0||BonusKurus>100000||amount!=(PaidKurus+BonusKurus)/100m)
                throw new ArgumentException("Invalid S TECH credit identity or amount.");
        }
    }
    internal sealed class MemberRecord
    {
        internal int Id,Login,Active;
        internal bool Expired;
        internal string Username;
        internal decimal Balance,Total;
    }
    internal sealed class TerminalRecord
    {
        internal int Id,Status,MemberId;
        internal string Name,Mac;
        internal bool IsVirtual;
    }
    internal sealed class CreditReceipt
    {
        public string operation_id,username,utc;
        public int member_id,operator_id,history_id,cash_id;
        public decimal amount,balance_before,balance_after,total_before,total_after;
    }
    internal sealed class ControllerDatabase
    {
        internal readonly string Path;
        private static readonly CultureInfo Invariant=CultureInfo.InvariantCulture;
        internal ControllerDatabase(string path){Path=path;}
        internal static string SqlText(string value){if(value==null||value.IndexOf('\0')>=0)throw new ArgumentException("Geçersiz metin.");return "'"+value.Replace("'","''")+"'";}
        private static string Number(decimal value){return value.ToString("0.############################",Invariant);}
        private static int Int(Dictionary<string,object> row,string name){return Convert.ToInt32(row[name],Invariant);}
        private static decimal Money(Dictionary<string,object> row,string name){return Decimal.Parse(Convert.ToString(row[name],Invariant),NumberStyles.Float,Invariant);}
        internal static void ValidateAmount(decimal amount)
        {
            if(amount<=0||amount>999999999.99m||Decimal.Round(amount,2)!=amount)throw new ArgumentException("Tutar 0,01 ile 999.999.999,99 TL arasında ve en fazla iki ondalık basamaklı olmalı.");
        }
        internal static void ValidateName(string value,int maximum)
        {
            if(String.IsNullOrWhiteSpace(value)||value.Length>maximum||Array.Exists(value.ToCharArray(),Char.IsControl))throw new ArgumentException("Kullanıcı veya bilgisayar adı geçersiz.");
        }
        internal static bool IsUsableMac(string value)
        {
            if(String.IsNullOrWhiteSpace(value))return false;
            var hex=new StringBuilder();
            foreach(char character in value)
            {
                // PanCafe's WOL routine removes hyphens before reading 12 hex digits.
                if(character=='-')continue;
                if(!Uri.IsHexDigit(character))return false;
                hex.Append(character);
            }
            if(hex.Length!=12)return false;
            byte first=Byte.Parse(hex.ToString(0,2),NumberStyles.HexNumber,Invariant);
            return (first&1)==0&&hex.ToString()!="000000000000";
        }
        private static MemberRecord Member(Dictionary<string,object> row)
        {
            return new MemberRecord{Id=Int(row,"ID"),Username=(string)row["USERNAME"],Login=Int(row,"LOGIN"),Active=Int(row,"ACCSTATUS"),Balance=Money(row,"BAKIYE"),Total=Money(row,"TOTALBAKIYE"),Expired=Int(row,"EXPIRED")!=0};
        }
        private const string MemberColumns="ID,USERNAME,LOGIN,ACCSTATUS,BAKIYE,TOTALBAKIYE,AVAILBONUS,USEDBONUS,CASE WHEN ENDDATE<CURRENT_DATE THEN 1 ELSE 0 END AS EXPIRED";
        internal MemberRecord FindMember(string username)
        {
            ValidateName(username,128);
            try
            {
                FbDb.Open(Path,false);
                var rows=FbDb.Query("SELECT "+MemberColumns+" FROM MEMBERS WHERE USERNAME="+SqlText(username));
                if(rows.Count==0)rows=FbDb.Query("SELECT "+MemberColumns+" FROM MEMBERS WHERE UPPER(USERNAME)=UPPER("+SqlText(username)+")");
                if(rows.Count!=1)throw new InvalidOperationException(rows.Count==0?"Bu kullanıcı adı PanCafe’de bulunamadı.":"Kullanıcı adı birden fazla kayıtla eşleşiyor; tam kullanıcı adını girin.");
                var member=Member(rows[0]);
                if(member.Active!=1)throw new InvalidOperationException("Üye hesabı aktif değil.");
                return member;
            }
            finally{FbDb.Close();}
        }
        internal TerminalRecord FindTerminal(string name)
        {
            ValidateName(name,200);
            try
            {
                FbDb.Open(Path,false);
                var rows=FbDb.Query("SELECT ID,NAME,TERMINALSTATUS,MEMBERID,ISVIRTUAL,MAC FROM TERMINALS WHERE NAME="+SqlText(name));
                if(rows.Count==0)rows=FbDb.Query("SELECT ID,NAME,TERMINALSTATUS,MEMBERID,ISVIRTUAL,MAC FROM TERMINALS WHERE UPPER(NAME)=UPPER("+SqlText(name)+")");
                if(rows.Count!=1)throw new InvalidOperationException(rows.Count==0?"Bu bilgisayar PanCafe’de bulunamadı.":"Bilgisayar adı tek bir terminalle eşleşmiyor.");
                return new TerminalRecord{Id=Int(rows[0],"ID"),Name=(string)rows[0]["NAME"],Status=Int(rows[0],"TERMINALSTATUS"),MemberId=Int(rows[0],"MEMBERID"),IsVirtual=Int(rows[0],"ISVIRTUAL")!=0,Mac=(string)rows[0]["MAC"]};
            }
            finally{FbDb.Close();}
        }
        internal CreditReceipt AddCredit(MemberRecord identity,decimal amount,decimal modelBalance,int modelLogin,int terminalId,int operatorId,string operationId,Action<CreditReceipt> beforeCommit,Action committed,CreditRequest request=null)
        {
            ValidateAmount(amount);
            if(request!=null)request.Validate(amount);
            try
            {
                FbDb.Open(Path,true);
                var rows=FbDb.Query("SELECT "+MemberColumns+" FROM MEMBERS WHERE ID="+identity.Id+" WITH LOCK");
                if(rows.Count!=1)throw new InvalidOperationException("Üye kaydı artık bulunamıyor.");
                var current=Member(rows[0]);
                bool replay=false,ticket=request!=null&&request.TicketId>0;
                int existingSale=0;
                if(request!=null)
                {
                    var stored=FbDb.Query(ticket?
                        "SELECT MEMBER_ID AS MEMBERID,USERNAME,AMOUNT,0 AS BONUS,BALANCE_AFTER AS DONE FROM STECH_TICKET_CREDITS WHERE TICKET_ID="+request.TicketId+" WITH LOCK":
                        "SELECT MEMBERID,USERNAME,AMOUNT,BONUS FROM STECH_MOBILE_CREDITS WHERE OPID="+SqlText(request.OperationId));
                    if(stored.Count==1)
                    {
                        if(Int(stored[0],"MEMBERID")!=identity.Id||(string)stored[0]["USERNAME"]!=identity.Username||Convert.ToInt64(stored[0]["AMOUNT"],Invariant)!=request.PaidKurus||Convert.ToInt64(stored[0]["BONUS"],Invariant)!=request.BonusKurus)
                            throw new InvalidOperationException("Credit identity or operation conflict.");
                        replay=!ticket||stored[0]["DONE"]!=null;
                    }
                }
                if(current.Username!=identity.Username||current.Active!=1||current.Login!=modelLogin||(!replay&&Math.Abs(current.Balance-modelBalance)>0.000001m))throw new InvalidOperationException("PanCafe ile veritabanındaki üye durumu uyuşmuyor; bakiye eklenmedi.");
                var terminals=FbDb.Query("SELECT ID FROM TERMINALS WHERE MEMBERID="+identity.Id+" AND TERMINALSTATUS=5 WITH LOCK");
                if((modelLogin==0&&terminals.Count!=0)||(modelLogin==1&&(terminals.Count!=1||Int(terminals[0],"ID")!=terminalId)))throw new InvalidOperationException("Üyenin açık oturumu doğrulanamadı; bakiye eklenmedi.");
                var bonus=FbDb.Query("SELECT VVALUE FROM VARIABLES WHERE VNAME='mbr_bonus_active'");
                if(bonus.Count!=1||(string)bonus[0]["VVALUE"]!="0")throw new InvalidOperationException("Bonus sistemi açık. Bu sürüm bonuslu yüklemeyi desteklemiyor.");
                if(operatorId<=0)throw new InvalidOperationException("PanCafe operatörü doğrulanamadı.");
                var admins=FbDb.Query("SELECT USERNAME,ACCACTIVE FROM ADMINLIST WHERE ID="+operatorId);
                if(admins.Count!=1||Int(admins[0],"ACCACTIVE")!=1)throw new InvalidOperationException("PanCafe operatörü aktif değil.");
                if(ticket&&modelLogin!=0)throw new InvalidOperationException("Bilet yüklemeden önce bilgisayardaki oturumu kapat.");
                // A committed S TECH receipt is in the same transaction as the money.
                // Replays only resynchronize the live model, including crash recovery.
                if(replay)
                {
                    var existing=new CreditReceipt{operation_id=operationId,username=identity.Username,member_id=identity.Id,operator_id=operatorId,amount=0,balance_before=current.Balance,balance_after=current.Balance,total_before=current.Total,total_after=current.Total,utc=DateTime.UtcNow.ToString("o")};
                    if(beforeCommit!=null)beforeCommit(existing);
                    FbDb.Commit();if(committed!=null)committed();return existing;
                }
                if(ticket)existingSale=ValidateTicket(request,identity,amount);
                decimal balance=checked(current.Balance+amount),total=ticket?current.Total:checked(current.Total+amount);
                if(Math.Abs(balance)>999999999.99m||Math.Abs(total)>999999999.99m)throw new InvalidOperationException("Hesap tutarı desteklenen aralığı aşıyor.");
                var ids=FbDb.Query("SELECT GEN_ID(GEN_MEMBERSHISTORY_ID,1) AS HISTORY_ID,GEN_ID(GEN_KASAHAR_ID,1) AS CASH_ID FROM RDB$DATABASE")[0];
                int history=Int(ids,"HISTORY_ID"),cash=Int(ids,"CASH_ID");
                FbDb.Update("UPDATE MEMBERS SET BAKIYE=BAKIYE+"+Number(amount)+(ticket?"":",TOTALBAKIYE=TOTALBAKIYE+"+Number(amount))+" WHERE ID="+identity.Id+" AND USERNAME="+SqlText(identity.Username));
                string marker=request==null||ticket?"":" STechPOS-"+Guid.Parse(request.OperationId).ToString("N");
                string historyNote=ticket?"Bilet Yüklendi. (Bilet No="+request.TicketId+")":"Hesaba para yüklendi."+marker;
                FbDb.InsertControllerRecord("INSERT INTO MEMBERSHISTORY (ID,MEMBERS_USERNAME,TARIH,SAAT,TERMINALNAME,MIKTAR,KALAN,NOTE) VALUES ("+history+","+SqlText(identity.Username)+",CURRENT_DATE,CURRENT_TIME,'',"+Number(amount)+","+Number(balance)+","+SqlText(historyNote)+")");
                if(existingSale!=0)cash=existingSale;
                else FbDb.InsertControllerRecord("INSERT INTO KASAHAR (ID,ADMINNAME,ISLEM,GELIRGIDER,TARIH,PRICE,NOTE,PAYMENTTYPE) VALUES ("+cash+","+SqlText((string)admins[0]["USERNAME"])+","+(ticket?8:4)+",0,CURRENT_TIMESTAMP,"+Number(amount)+","+SqlText(ticket?"Bilet No:"+request.TicketId:"Üye hesabına para yüklendi. ("+identity.Username+")")+",0)");
                var afterRows=FbDb.Query("SELECT "+MemberColumns+" FROM MEMBERS WHERE ID="+identity.Id);
                var after=Member(afterRows[0]);
                var historyRows=FbDb.Query("SELECT MIKTAR,KALAN,MEMBERS_USERNAME FROM MEMBERSHISTORY WHERE ID="+history);
                var cashRows=FbDb.Query("SELECT PRICE FROM KASAHAR WHERE ID="+cash);
                if(Math.Abs(after.Balance-balance)>0.000001m||Math.Abs(after.Total-total)>0.000001m||after.Login!=modelLogin||(string)afterRows[0]["AVAILBONUS"]!=(string)rows[0]["AVAILBONUS"]||(string)afterRows[0]["USEDBONUS"]!=(string)rows[0]["USEDBONUS"]||historyRows.Count!=1||Math.Abs(Money(historyRows[0],"MIKTAR")-amount)>0.000001m||Math.Abs(Money(historyRows[0],"KALAN")-balance)>0.000001m||(string)historyRows[0]["MEMBERS_USERNAME"]!=identity.Username||cashRows.Count!=1||Math.Abs(Money(cashRows[0],"PRICE")-amount)>0.000001m)throw new InvalidOperationException("Bakiye ve hareket kayıtları doğrulanamadı; işlem geri alındı.");
                var receipt=new CreditReceipt{operation_id=operationId,username=identity.Username,member_id=identity.Id,operator_id=operatorId,amount=amount,balance_before=current.Balance,balance_after=after.Balance,total_before=current.Total,total_after=after.Total,history_id=history,cash_id=cash,utc=DateTime.UtcNow.ToString("o")};
                if(ticket)
                {
                    FbDb.Update("UPDATE TICKETS SET SOLD=1,USED=1 WHERE ID="+request.TicketId);
                    var claims=FbDb.Query("SELECT TICKET_ID FROM STECH_TICKET_CREDITS WHERE TICKET_ID="+request.TicketId);
                    if(claims.Count==0)
                        FbDb.InsertControllerRecord("INSERT INTO STECH_TICKET_CREDITS (TICKET_ID,MEMBER_ID,USERNAME,AMOUNT,SALE_AFTER,BALANCE_AFTER) VALUES ("+request.TicketId+","+identity.Id+","+SqlText(identity.Username)+","+request.PaidKurus.ToString(Invariant)+",0,"+Number(after.Balance)+")");
                    else FbDb.Update("UPDATE STECH_TICKET_CREDITS SET BALANCE_AFTER="+Number(after.Balance)+" WHERE TICKET_ID="+request.TicketId);
                }
                else if(request!=null)
                    FbDb.InsertControllerRecord("INSERT INTO STECH_MOBILE_CREDITS (OPID,MEMBERID,USERNAME,AMOUNT,BONUS,BALANCEAFTER) VALUES ("+SqlText(request.OperationId)+","+identity.Id+","+SqlText(identity.Username)+","+request.PaidKurus.ToString(Invariant)+","+request.BonusKurus.ToString(Invariant)+","+Number(after.Balance)+")");
                if(beforeCommit!=null)beforeCommit(receipt);
                FbDb.Commit();
                if(committed!=null)committed();
                return receipt;
            }
            finally{FbDb.Close();}
        }
        private static int ValidateTicket(CreditRequest request,MemberRecord member,decimal amount)
        {
            var rows=FbDb.Query("SELECT BARCODE,SOLD,USED,LOGIN,MEMBERCREDIT,PRICE,CASE WHEN EXPDATE IS NULL OR EXPDATE>=CURRENT_DATE THEN 1 ELSE 0 END AS VALID_DATE FROM TICKETS WHERE ID="+request.TicketId+" WITH LOCK");
            if(rows.Count!=1||(string)rows[0]["BARCODE"]!=request.Barcode||Int(rows[0],"USED")!=0||Int(rows[0],"LOGIN")!=0||Int(rows[0],"MEMBERCREDIT")!=1||Int(rows[0],"VALID_DATE")!=1||Math.Abs(Money(rows[0],"PRICE")-amount)>0.000001m)
                throw new InvalidOperationException("Bilet kullanılmış, kullanımda, süresi dolmuş veya tutarı değişmiş.");
            if(Int(rows[0],"SOLD")==0)return 0;
            // Migrate an unfinished former UI sale only with its durable member claim
            // and exactly one cash receipt. Never charge for that sale a second time.
            var claims=FbDb.Query("SELECT SALE_AFTER FROM STECH_TICKET_CREDITS WHERE TICKET_ID="+request.TicketId+" AND MEMBER_ID="+member.Id+" AND USERNAME="+SqlText(member.Username)+" AND BALANCE_AFTER IS NULL");
            if(claims.Count!=1)throw new InvalidOperationException("Biletin önceki satış sahibi doğrulanamadı.");
            var sales=FbDb.Query("SELECT ID,PRICE FROM KASAHAR WHERE ID>"+Convert.ToInt64(claims[0]["SALE_AFTER"],Invariant)+" AND ISLEM=8 AND GELIRGIDER=0 AND NOTE="+SqlText("Bilet No:"+request.TicketId));
            if(sales.Count!=1||Math.Abs(Money(sales[0],"PRICE")-amount)>0.000001m)throw new InvalidOperationException("Biletin önceki kasa satışı doğrulanamadı.");
            return Int(sales[0],"ID");
        }
        internal void VerifySession(int memberId,int terminalId)
        {
            try
            {
                FbDb.Open(Path,false);
                var member=FbDb.Query("SELECT LOGIN FROM MEMBERS WHERE ID="+memberId);
                var terminal=FbDb.Query("SELECT MEMBERID,TERMINALSTATUS FROM TERMINALS WHERE ID="+terminalId);
                if(member.Count!=1||Int(member[0],"LOGIN")!=1||terminal.Count!=1||Int(terminal[0],"MEMBERID")!=memberId||Int(terminal[0],"TERMINALSTATUS")!=5)throw new InvalidOperationException("Oturumun veritabanındaki sonucu doğrulanamadı.");
            }
            finally{FbDb.Close();}
        }
        internal void VerifyLockedSnapshot(int memberId,decimal expectedBalance,int expectedLogin)
        {
            try
            {
                FbDb.Open(Path,true);
                var rows=FbDb.Query("SELECT BAKIYE,LOGIN FROM MEMBERS WHERE ID="+memberId+" WITH LOCK");
                if(rows.Count!=1||Math.Abs(Money(rows[0],"BAKIYE")-expectedBalance)>0.000001m||Int(rows[0],"LOGIN")!=expectedLogin)throw new InvalidOperationException("Canlı işlem ön kontrolü uyuşmadı.");
            }
            finally{FbDb.Close();} // rollback releases the read lock; no writes/commit
        }
    }
}
