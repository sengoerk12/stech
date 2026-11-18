using System;
using System.Globalization;

public static class TestPanCafeTicketCredit {
    static void Expect(bool condition, string message) {
        if (!condition) throw new InvalidOperationException(message);
    }

    public static int Main(string[] args) {
        try {
            string db = args[0], client = args[1];
            string user = "st_ticket_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            PanCafeMemberWriter.Create(db, client, new[] {user, "TicketTest123!", "Test", "Ticket", "", ""});
            string member = PanCafeReadOnly.Query(db, client, "SELECT ID FROM MEMBERS WHERE USERNAME='" + user + "'")[0]["ID"];
            PanCafeNativeSessions.InitializeTickets(db, client);
            PanCafeNativeSessions.InitializeTickets(db, client);
            var ticket = PanCafeReadOnly.Query(db, client,
                "SELECT FIRST 1 ID,BARCODE,CAST(PRICE AS DECIMAL(18,2)) AS PRICE_TL FROM TICKETS" +
                " WHERE MEMBERCREDIT=1 AND SOLD=0 AND USED=0 AND PRICE>0 AND EXPDATE IS NULL ORDER BY ID")[0];
            string id = ticket["ID"], barcode = ticket["BARCODE"], price = ticket["PRICE_TL"];
            string amount = (Decimal.Parse(price, CultureInfo.InvariantCulture) * 100m).ToString("0", CultureInfo.InvariantCulture);
            var credit = new[] {id, member, user, amount};
            string before = PanCafeReadOnly.Query(db, client, "SELECT MAX(ID) AS N FROM KASAHAR")[0]["N"];
            PanCafeReadOnly.Write(db, client,
                "INSERT INTO STECH_TICKET_CREDITS(TICKET_ID,MEMBER_ID,USERNAME,AMOUNT,SALE_AFTER) VALUES(?,?,?,?,?)",
                new[] {id, member, user, amount, before});
            Expect(PanCafeNativeSessions.ApplyTicketSale(db, client, credit)[0]["RESULT_CODE"] == "awaiting_sale", "Unsold ticket credited");
            PanCafeReadOnly.Write(db, client, "UPDATE TICKETS SET SOLD=1 WHERE ID=?", new[] {id});
            Expect(PanCafeNativeSessions.ApplyTicketSale(db, client, credit)[0]["RESULT_CODE"] == "awaiting_sale", "Sale without receipt credited");
            PanCafeReadOnly.Write(db, client,
                "INSERT INTO KASAHAR(ADMINNAME,ISLEM,GELIRGIDER,TARIH,PRICE,NOTE,PAYMENTTYPE) VALUES('test',8,0,CURRENT_TIMESTAMP,?,?,0)",
                new[] {price, "Bilet No:" + id});
            var credited = PanCafeNativeSessions.RedeemTicket(db, client, Int32.Parse(member), user, barcode)[0];
            Expect(credited["RESULT_CODE"] == "ok" && credited["AMOUNT_KURUS"] == amount && credited["BALANCE_TL"] == price, "Valid sale not credited");
            Expect(PanCafeNativeSessions.RedeemTicket(db, client, Int32.Parse(member), user, barcode)[0]["RESULT_CODE"] == "already_credited", "Repeat sale response incorrect");
            Expect(PanCafeNativeSessions.RedeemTicket(db, client, Int32.Parse(member) + 1, "other", barcode)[0]["RESULT_CODE"] == "unavailable", "Another user could redeem the ticket");
            Expect(PanCafeReadOnly.Query(db, client, "SELECT USED FROM TICKETS WHERE ID=" + id)[0]["USED"] == "1", "Ticket still usable");
            Expect(PanCafeReadOnly.Query(db, client, "SELECT COUNT(*) AS N FROM MEMBERSHISTORY WHERE MEMBERS_USERNAME='" + user +
                "' AND NOTE='Bilet Yüklendi. (Bilet No=" + id + ")'")[0]["N"] == "1", "Expected one member history entry");
            Expect(PanCafeReadOnly.Query(db, client, "SELECT COUNT(*) AS N FROM KASAHAR WHERE ID>" + before +
                " AND NOTE='Bilet No:" + id + "'")[0]["N"] == "1", "Ticket credit created a second cash sale");
            Console.WriteLine("Ticket sale proof, member credit, ticket consumption, and retry protection passed.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
