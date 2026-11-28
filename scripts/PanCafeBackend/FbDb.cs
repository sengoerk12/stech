using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

// Native Firebird helpers for the explicitly authorized session experiment.
internal static partial class FbDb
{
    const string Dll = "fbembed.dll";
    [DllImport(Dll)] static extern IntPtr isc_attach_database(IntPtr[] s, short len, byte[] file, ref IntPtr db, short dl, byte[] dpb);
    [DllImport(Dll)] static extern IntPtr isc_detach_database(IntPtr[] s, ref IntPtr db);
    [DllImport(Dll)] static extern IntPtr isc_start_multiple(IntPtr[] s, ref IntPtr tr, short count, IntPtr teb);
    [DllImport(Dll)] static extern IntPtr isc_rollback_transaction(IntPtr[] s, ref IntPtr tr);
    [DllImport(Dll)] static extern IntPtr isc_dsql_allocate_statement(IntPtr[] s, ref IntPtr db, ref IntPtr st);
    [DllImport(Dll)] static extern IntPtr isc_dsql_prepare(IntPtr[] s, ref IntPtr tr, ref IntPtr st, ushort len, byte[] sql, ushort dialect, IntPtr da);
    [DllImport(Dll)] static extern IntPtr isc_dsql_execute(IntPtr[] s, ref IntPtr tr, ref IntPtr st, ushort dialect, IntPtr input);
    [DllImport(Dll)] static extern IntPtr isc_dsql_fetch(IntPtr[] s, ref IntPtr st, ushort dialect, IntPtr da);
    [DllImport(Dll)] static extern IntPtr isc_dsql_free_statement(IntPtr[] s, ref IntPtr st, ushort option);
    [DllImport(Dll)] static extern int fb_interpret(StringBuilder buffer, uint len, ref IntPtr status);
    [DllImport(Dll)] static extern IntPtr isc_open_blob2(IntPtr[] s, ref IntPtr db, ref IntPtr tr, ref IntPtr blob, IntPtr id, short len, IntPtr bpb);
    [DllImport(Dll)] static extern IntPtr isc_get_segment(IntPtr[] s, ref IntPtr blob, out ushort actual, ushort size, byte[] buffer);
    [DllImport(Dll)] static extern IntPtr isc_close_blob(IntPtr[] s, ref IntPtr blob);

    static readonly IntPtr[] Status = new IntPtr[20];
    static IntPtr Db, Tr;
    static void Check(IntPtr code)
    {
        if (code == IntPtr.Zero) return;
        var pinned = GCHandle.Alloc(Status, GCHandleType.Pinned);
        try
        {
            IntPtr p = pinned.AddrOfPinnedObject();
            var messages = new List<string>();
            var buffer = new StringBuilder(2048);
            while (fb_interpret(buffer, 2048, ref p) != 0) messages.Add(buffer.ToString());
            throw new InvalidOperationException("Firebird " + code.ToInt64() + ": " + string.Join("; ", messages));
        }
        finally { pinned.Free(); }
    }
    static string BlobText(IntPtr id)
    {
        IntPtr blob = IntPtr.Zero;
        Check(isc_open_blob2(Status, ref Db, ref Tr, ref blob, id, 0, IntPtr.Zero));
        try
        {
            using (var result = new MemoryStream())
            {
                var buffer = new byte[8192];
                while (true)
                {
                    ushort actual;
                    long code = isc_get_segment(Status, ref blob, out actual, (ushort)buffer.Length, buffer).ToInt64();
                    if (actual > 0) result.Write(buffer, 0, actual);
                    if (code == 335544367) break;
                    if (code != 0 && code != 335544366) Check(new IntPtr(code));
                    if (result.Length > 4000000) throw new InvalidDataException("Blob exceeds analysis limit.");
                }
                return Encoding.UTF8.GetString(result.ToArray());
            }
        }
        finally { Check(isc_close_blob(Status, ref blob)); }
    }
    internal static List<Dictionary<string, object>> Query(string sql)
    {
        if (!sql.TrimStart().StartsWith("SELECT ", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Only SELECT queries are accepted.");
        IntPtr st = IntPtr.Zero;
        IntPtr da = Marshal.AllocHGlobal(20 + 152 * 128);
        var memory = new List<IntPtr>();
        try
        {
            Marshal.Copy(new byte[20 + 152 * 128], 0, da, 20 + 152 * 128);
            Marshal.WriteInt16(da, 0, 1);
            Marshal.WriteInt32(da, 12, 20 + 152 * 128);
            Marshal.WriteInt16(da, 16, 128);
            Check(isc_dsql_allocate_statement(Status, ref Db, ref st));
            byte[] bytes = Encoding.UTF8.GetBytes(sql);
            Check(isc_dsql_prepare(Status, ref Tr, ref st, (ushort)bytes.Length, bytes, 3, da));
            int count = Marshal.ReadInt16(da, 18);
            if (count > 128) throw new InvalidDataException("Too many columns.");
            var names = new string[count];
            var blobs = new bool[count];
            for (int i = 0; i < count; i++)
            {
                IntPtr v = IntPtr.Add(da, 20 + 152 * i);
                int aliasLen = Marshal.ReadInt16(v, 118);
                var aliasBytes = new byte[aliasLen];
                Marshal.Copy(IntPtr.Add(v, 120), aliasBytes, 0, aliasLen);
                names[i] = Encoding.UTF8.GetString(aliasBytes);
                blobs[i] = (Marshal.ReadInt16(v, 0) & ~1) == 520;
                IntPtr data = Marshal.AllocHGlobal(32768);
                IntPtr ind = Marshal.AllocHGlobal(2);
                memory.Add(data); memory.Add(ind);
                Marshal.WriteIntPtr(v, 8, data);
                Marshal.WriteIntPtr(v, 12, ind);
                if (!blobs[i])
                {
                    Marshal.WriteInt16(v, 0, 449);
                    Marshal.WriteInt16(v, 2, 0);
                    Marshal.WriteInt16(v, 4, 0);
                    Marshal.WriteInt16(v, 6, (short)Math.Min(4096, 58000 / Math.Max(1, count) - 2));
                }
            }
            Check(isc_dsql_execute(Status, ref Tr, ref st, 3, IntPtr.Zero));
            var rows = new List<Dictionary<string, object>>();
            while (true)
            {
                IntPtr code = isc_dsql_fetch(Status, ref st, 3, da);
                if (code.ToInt64() == 100) break;
                Check(code);
                var row = new Dictionary<string, object>();
                for (int i = 0; i < count; i++)
                {
                    IntPtr v = IntPtr.Add(da, 20 + 152 * i);
                    IntPtr data = Marshal.ReadIntPtr(v, 8);
                    if (Marshal.ReadInt16(Marshal.ReadIntPtr(v, 12)) < 0) row[names[i]] = null;
                    else if (blobs[i]) row[names[i]] = BlobText(data);
                    else
                    {
                        int len = (ushort)Marshal.ReadInt16(data);
                        var text = new byte[len];
                        Marshal.Copy(IntPtr.Add(data, 2), text, 0, len);
                        row[names[i]] = Encoding.UTF8.GetString(text).TrimEnd();
                    }
                }
                rows.Add(row);
                if (rows.Count > 20000) throw new InvalidDataException("Row limit exceeded.");
            }
            return rows;
        }
        finally
        {
            if (st != IntPtr.Zero) Check(isc_dsql_free_statement(Status, ref st, 2));
            foreach (IntPtr item in memory) Marshal.FreeHGlobal(item);
            Marshal.FreeHGlobal(da);
        }
    }
}
