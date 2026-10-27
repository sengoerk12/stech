using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

// Firebird 2.5 x86 reader. Every query runs in a READ ONLY, NO WAIT transaction.
// The installed PanCafe engine is used without changing its configuration.
public static class PanCafeReadOnly
{
    public static int Main(string[] args)
    {
        try {
            if(args.Length!=3) throw new ArgumentException("Expected database, client directory and base64 SELECT.");
            Console.OutputEncoding=new UTF8Encoding(false);
            var sql=Encoding.UTF8.GetString(Convert.FromBase64String(args[2]));
            Console.Write(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(Query(args[0],args[1],sql)));
            return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] internal static extern bool SetDllDirectory(string path);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_attach_database(int[] status, short length, byte[] path, ref IntPtr db, short dpbLength, byte[] dpb);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_detach_database(int[] status, ref IntPtr db);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_start_transaction(int[] status, ref IntPtr transaction, short count, ref IntPtr db, short length, byte[] tpb);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_rollback_transaction(int[] status, ref IntPtr transaction);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_commit_transaction(int[] status, ref IntPtr transaction);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_dsql_allocate_statement(int[] status, ref IntPtr db, ref IntPtr statement);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_dsql_prepare(int[] status, ref IntPtr transaction, ref IntPtr statement, ushort length, byte[] sql, ushort dialect, IntPtr descriptor);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_dsql_execute(int[] status, ref IntPtr transaction, ref IntPtr statement, ushort dialect, IntPtr descriptor);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_dsql_fetch(int[] status, ref IntPtr statement, ushort dialect, IntPtr descriptor);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int isc_dsql_free_statement(int[] status, ref IntPtr statement, ushort option);
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)] internal static extern int fb_interpret(StringBuilder buffer, uint length, ref IntPtr status);

    internal static void Check(int result, int[] status)
    {
        if (result == 0) return;
        var pin = GCHandle.Alloc(status, GCHandleType.Pinned);
        try {
            IntPtr cursor = pin.AddrOfPinnedObject();
            var messages = new List<string>();
            for (int i=0; i<8; i++) {
                var buffer = new StringBuilder(2048);
                if (fb_interpret(buffer, 2048, ref cursor) == 0) break;
                messages.Add(buffer.ToString());
            }
            throw new InvalidOperationException(String.Join("; ", messages.ToArray()));
        } finally { pin.Free(); }
    }

    public static List<Dictionary<string,string>> Query(string database, string clientDirectory, string sql)
    {
        if (IntPtr.Size != 4) throw new InvalidOperationException("PanCafe requires the x86 PowerShell host.");
        if (!sql.TrimStart().StartsWith("SELECT ", StringComparison.OrdinalIgnoreCase) || sql.Contains(";"))
            throw new InvalidOperationException("Only a single SELECT is accepted.");
        return Run(database,clientDirectory,sql,false,null);
    }
    internal static List<Dictionary<string,string>> Write(string database,string clientDirectory,string sql,string[] parameters) {
        return Run(database,clientDirectory,sql,true,parameters);
    }
    static List<Dictionary<string,string>> Run(string database,string clientDirectory,string sql,bool write,string[] parameters) {
        if(IntPtr.Size!=4) throw new InvalidOperationException("PanCafe requires x86.");
        if (!SetDllDirectory(clientDirectory)) throw new InvalidOperationException("Client directory unavailable.");
        var status = new int[20];
        IntPtr db=IntPtr.Zero, transaction=IntPtr.Zero, statement=IntPtr.Zero, descriptor=IntPtr.Zero,input=IntPtr.Zero;
        var allocated = new List<IntPtr>();
        var rows = new List<Dictionary<string,string>>();
        try {
            // Embedded engine authentication is filesystem based. No password is read or guessed.
            var dpb = new List<byte>(new byte[]{1,28,6});
            dpb.AddRange(Encoding.ASCII.GetBytes("SYSDBA"));
            dpb.AddRange(new byte[]{48,4,85,84,70,56,16,1,1,72,1,1});
            var path = Encoding.Default.GetBytes(database);
            Check(isc_attach_database(status,(short)path.Length,path,ref db,(short)dpb.Count,dpb.ToArray()),status);
            // version3, read, read_committed, rec_version, nowait
            byte[] tpb={3,(byte)(write?9:8),15,17,7};
            Check(isc_start_transaction(status,ref transaction,1,ref db,(short)tpb.Length,tpb),status);
            Check(isc_dsql_allocate_statement(status,ref db,ref statement),status);
            int descriptorSize=20+64*152;
            descriptor=Marshal.AllocHGlobal(descriptorSize);
            Marshal.Copy(new byte[descriptorSize],0,descriptor,descriptorSize);
            Marshal.WriteInt16(descriptor,0,1);
            Marshal.WriteInt32(descriptor,12,descriptorSize);
            Marshal.WriteInt16(descriptor,16,64);
            var sqlBytes=Encoding.UTF8.GetBytes(sql);
            Check(isc_dsql_prepare(status,ref transaction,ref statement,(ushort)sqlBytes.Length,sqlBytes,3,descriptor),status);
            int count=Marshal.ReadInt16(descriptor,18);
            if (count<0 || count>64 || (!write && count==0)) throw new InvalidOperationException("Unexpected column count.");
            if(parameters!=null && parameters.Length>0) {
                int inputSize=20+parameters.Length*152;
                input=Marshal.AllocHGlobal(inputSize);allocated.Add(input);
                Marshal.Copy(new byte[inputSize],0,input,inputSize);
                Marshal.WriteInt16(input,0,1);Marshal.WriteInt32(input,12,inputSize);
                Marshal.WriteInt16(input,16,(short)parameters.Length);Marshal.WriteInt16(input,18,(short)parameters.Length);
                for(int i=0;i<parameters.Length;i++) {
                    byte[] value=Encoding.UTF8.GetBytes(parameters[i]);
                    IntPtr data=Marshal.AllocHGlobal(value.Length+2);allocated.Add(data);
                    Marshal.WriteInt16(data,(short)value.Length);Marshal.Copy(value,0,IntPtr.Add(data,2),value.Length);
                    IntPtr indicator=Marshal.AllocHGlobal(2);allocated.Add(indicator);Marshal.WriteInt16(indicator,0);
                    IntPtr field=IntPtr.Add(input,20+i*152);
                    Marshal.WriteInt16(field,0,449);Marshal.WriteInt16(field,4,4);Marshal.WriteInt16(field,6,(short)Math.Max(1,value.Length));
                    Marshal.WriteIntPtr(field,8,data);Marshal.WriteIntPtr(field,12,indicator);
                }
            }
            var names=new string[count]; var values=new IntPtr[count]; var nulls=new IntPtr[count];
            for(int i=0;i<count;i++) {
                IntPtr field=IntPtr.Add(descriptor,20+i*152);
                int nameLength=Marshal.ReadInt16(field,118);
                var nameBytes=new byte[nameLength];
                Marshal.Copy(IntPtr.Add(field,120),nameBytes,0,nameLength);
                names[i]=Encoding.UTF8.GetString(nameBytes).Trim();
                values[i]=Marshal.AllocHGlobal(4098); allocated.Add(values[i]);
                nulls[i]=Marshal.AllocHGlobal(2); allocated.Add(nulls[i]);
                Marshal.WriteInt16(field,0,449); // nullable SQL_VARYING
                Marshal.WriteInt16(field,2,0);
                Marshal.WriteInt16(field,4,4); // UTF8
                Marshal.WriteInt16(field,6,4096);
                Marshal.WriteIntPtr(field,8,values[i]);
                Marshal.WriteIntPtr(field,12,nulls[i]);
            }
            Check(isc_dsql_execute(status,ref transaction,ref statement,3,input),status);
            if(count==0) {
                Check(isc_commit_transaction(status,ref transaction),status);
                return rows;
            }
            for(int n=0;n<250;n++) {
                int result=isc_dsql_fetch(status,ref statement,3,descriptor);
                if(result==100) {
                    if(write) Check(isc_commit_transaction(status,ref transaction),status);
                    return rows;
                }
                Check(result,status);
                var row=new Dictionary<string,string>();
                for(int i=0;i<count;i++) {
                    if(Marshal.ReadInt16(nulls[i])<0) {row[names[i]]=null;continue;}
                    int length=Marshal.ReadInt16(values[i]);
                    if(length<0 || length>4096) throw new InvalidOperationException("Invalid field length.");
                    var bytes=new byte[length]; Marshal.Copy(IntPtr.Add(values[i],2),bytes,0,length);
                    row[names[i]]=Encoding.UTF8.GetString(bytes).TrimEnd();
                }
                rows.Add(row);
            }
            throw new InvalidOperationException("Query row limit exceeded; narrow the query.");
        } finally {
            if(statement!=IntPtr.Zero) isc_dsql_free_statement(status,ref statement,2);
            if(transaction!=IntPtr.Zero) isc_rollback_transaction(status,ref transaction);
            if(db!=IntPtr.Zero) isc_detach_database(status,ref db);
            foreach(var memory in allocated) Marshal.FreeHGlobal(memory);
            if(descriptor!=IntPtr.Zero) Marshal.FreeHGlobal(descriptor);
        }
    }
}
