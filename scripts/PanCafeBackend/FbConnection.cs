using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static partial class FbDb
{
    [DllImport(Dll)] static extern IntPtr isc_commit_transaction(IntPtr[] s, ref IntPtr tr);
    [DllImport(Dll)] static extern IntPtr isc_dsql_execute_immediate(IntPtr[] s, ref IntPtr db, ref IntPtr tr, ushort len, byte[] sql, ushort dialect, IntPtr da);
    [DllImport(Dll)] static extern IntPtr isc_service_attach(IntPtr[] s, ushort len, byte[] name, ref IntPtr service, ushort spblen, byte[] spb);
    [DllImport(Dll)] static extern IntPtr isc_service_detach(IntPtr[] s, ref IntPtr service);
    [DllImport(Dll)] static extern IntPtr isc_service_start(IntPtr[] s, ref IntPtr service, IntPtr reserved, ushort len, byte[] spb);
    [DllImport(Dll)] static extern IntPtr isc_service_query(IntPtr[] s, ref IntPtr service, IntPtr reserved, ushort sendlen, byte[] send, ushort reqlen, byte[] req, ushort size, byte[] result);

    internal static void Open(string file, bool writable)
    {
        if (Db != IntPtr.Zero) throw new InvalidOperationException("Connection already open.");
        byte[] path = Encoding.Default.GetBytes(Path.GetFullPath(file));
        byte[] dpb = {1, 28, 6, 83, 89, 83, 68, 66, 65, 48, 4, 85, 84, 70, 56};
        Check(isc_attach_database(Status, (short)path.Length, path, ref Db, (short)dpb.Length, dpb));
        byte[] tpb = {3, (byte)(writable ? 9 : 8), 2, 7};
        IntPtr dbp = Marshal.AllocHGlobal(4), tp = Marshal.AllocHGlobal(tpb.Length), teb = Marshal.AllocHGlobal(12);
        try
        {
            Marshal.WriteIntPtr(dbp, Db); Marshal.Copy(tpb, 0, tp, tpb.Length);
            Marshal.WriteIntPtr(teb, 0, dbp); Marshal.WriteInt32(teb, 4, tpb.Length); Marshal.WriteIntPtr(teb, 8, tp);
            Check(isc_start_multiple(Status, ref Tr, 1, teb));
        }
        finally { Marshal.FreeHGlobal(dbp); Marshal.FreeHGlobal(tp); Marshal.FreeHGlobal(teb); }
    }
    internal static void Close()
    {
        try { if (Tr != IntPtr.Zero) Check(isc_rollback_transaction(Status, ref Tr)); }
        finally { if (Db != IntPtr.Zero) Check(isc_detach_database(Status, ref Db)); }
    }
    internal static void Commit() { Check(isc_commit_transaction(Status, ref Tr)); }
    internal static void Update(string sql)
    {
        if (!sql.StartsWith("UPDATE MEMBERS ", StringComparison.Ordinal) && !sql.StartsWith("UPDATE TERMINALS ", StringComparison.Ordinal) && !sql.StartsWith("UPDATE TICKETS ", StringComparison.Ordinal) && !sql.StartsWith("UPDATE STECH_TICKET_CREDITS ", StringComparison.Ordinal))
            throw new ArgumentException("Only scoped member/terminal updates are permitted.");
        byte[] bytes = Encoding.UTF8.GetBytes(sql);
        Check(isc_dsql_execute_immediate(Status, ref Db, ref Tr, (ushort)bytes.Length, bytes, 3, IntPtr.Zero));
    }
    static void StringParam(List<byte> p, byte code, string value)
    {
        byte[] b = Encoding.Default.GetBytes(value);
        p.Add(code); p.Add((byte)b.Length); p.Add((byte)(b.Length >> 8)); p.AddRange(b);
    }
    internal static void BackupRestore(bool restore, string database, string backup, string logfile)
    {
        // Restore never overwrites any existing file, especially the live database.
        if (File.Exists(restore ? database : backup)) throw new IOException("Destination already exists.");
        IntPtr service = IntPtr.Zero;
        var lines = new List<string>();
        try
        {
            byte[] name = Encoding.ASCII.GetBytes("service_mgr");
            byte[] attach = {2, 2, 28, 6, 83, 89, 83, 68, 66, 65};
            Check(isc_service_attach(Status, (ushort)name.Length, name, ref service, (ushort)attach.Length, attach));
            var parameters = new List<byte> { (byte)(restore ? 2 : 1) };
            StringParam(parameters, 106, database); // isc_spb_dbname
            StringParam(parameters, 5, backup); // isc_spb_bkp_file
            parameters.Add(108); // isc_spb_options, 32-bit little endian
            parameters.AddRange(BitConverter.GetBytes(restore ? 0x2000 : 0x08)); // CREATE, or no garbage collection
            parameters.Add(107); // verbose output, including task errors
            byte[] spb = parameters.ToArray();
            Check(isc_service_start(Status, ref service, IntPtr.Zero, (ushort)spb.Length, spb));
            var timer = Stopwatch.StartNew();
            while (true)
            {
                var buffer = new byte[8192];
                byte[] timeout = {64, 4, 0, 1, 0, 0, 0};
                byte[] request = {62}; // isc_info_svc_line
                Check(isc_service_query(Status, ref service, IntPtr.Zero, (ushort)timeout.Length, timeout, 1, request, (ushort)buffer.Length, buffer));
                if (buffer[0] != 62) throw new InvalidDataException("Unexpected service response: " + buffer[0]);
                int length = buffer[1] | buffer[2] << 8;
                if (length > buffer.Length - 3) throw new InvalidDataException("Truncated service output.");
                if (length > 0)
                {
                    string line = Encoding.Default.GetString(buffer, 3, length);
                    lines.Add(line);
                    if (line.IndexOf("ERROR", StringComparison.OrdinalIgnoreCase) >= 0 || line.IndexOf("Exiting before completion", StringComparison.OrdinalIgnoreCase) >= 0)
                        throw new InvalidOperationException(line);
                }
                else
                {
                    byte[] runningRequest = {67};
                    var running = new byte[16];
                    Check(isc_service_query(Status, ref service, IntPtr.Zero, 0, null, 1, runningRequest, (ushort)running.Length, running));
                    if (running[0] != 67) throw new InvalidDataException("Invalid running response.");
                    if (BitConverter.ToInt32(running, 1) == 0) break;
                    Thread.Sleep(50);
                }
                if (timer.Elapsed > TimeSpan.FromMinutes(2)) throw new TimeoutException("Backup/restore exceeded two minutes.");
            }
        }
        finally
        {
            File.WriteAllLines(logfile, lines, new UTF8Encoding(false));
            if (service != IntPtr.Zero) Check(isc_service_detach(Status, ref service));
        }
        string target = restore ? database : backup;
        if (!File.Exists(target) || new FileInfo(target).Length == 0) throw new IOException("Backup/restore produced no file.");
        Console.WriteLine((restore ? "RESTORE VERIFIED FILE CREATED: " : "CONSISTENT BACKUP CREATED: ") + target);
    }
}
