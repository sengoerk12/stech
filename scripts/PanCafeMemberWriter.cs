using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

// Only creates new members. Existing member passwords and balances are never updated.
public static class PanCafeMemberWriter
{
    [DllImport("fbembed.dll", CallingConvention=CallingConvention.StdCall)]
    static extern int isc_commit_transaction(int[] status, ref IntPtr transaction);

    public static void Create(string database, string clientDirectory, string[] fields)
    {
        if (IntPtr.Size!=4 || fields.Length!=6) throw new ArgumentException("Invalid member creation request.");
        PanCafeReadOnly.SetDllDirectory(clientDirectory);
        var status=new int[20];
        IntPtr db=IntPtr.Zero, transaction=IntPtr.Zero, statement=IntPtr.Zero, descriptor=IntPtr.Zero;
        var memory=new List<KeyValuePair<IntPtr,int>>();
        try {
            var dpb=new List<byte>(new byte[]{1,28,6});
            dpb.AddRange(Encoding.ASCII.GetBytes("SYSDBA"));
            dpb.AddRange(new byte[]{48,4,85,84,70,56,16,1,1,72,1,1});
            byte[] path=Encoding.Default.GetBytes(database);
            PanCafeReadOnly.Check(PanCafeReadOnly.isc_attach_database(status,(short)path.Length,path,ref db,(short)dpb.Count,dpb.ToArray()),status);
            byte[] tpb={3,9,15,17,7};
            PanCafeReadOnly.Check(PanCafeReadOnly.isc_start_transaction(status,ref transaction,1,ref db,(short)tpb.Length,tpb),status);
            PanCafeReadOnly.Check(PanCafeReadOnly.isc_dsql_allocate_statement(status,ref db,ref statement),status);
            byte[] sql=Encoding.ASCII.GetBytes("INSERT INTO MEMBERS (USERNAME,PASSWORD,NAME,LASTNAME,GSM,EMAIL,BAKIYE,AVAILBONUS,USEDBONUS,TOTALBAKIYE,AVANS,TOTALACTMINUTE) VALUES (?,?,?,?,?,?,0,0,0,0,0,0)");
            PanCafeReadOnly.Check(PanCafeReadOnly.isc_dsql_prepare(status,ref transaction,ref statement,(ushort)sql.Length,sql,3,IntPtr.Zero),status);
            int size=20+6*152;
            descriptor=Marshal.AllocHGlobal(size);
            Marshal.Copy(new byte[size],0,descriptor,size);
            Marshal.WriteInt16(descriptor,0,1);
            Marshal.WriteInt32(descriptor,12,size);
            Marshal.WriteInt16(descriptor,16,6); Marshal.WriteInt16(descriptor,18,6);
            for(int i=0;i<6;i++) {
                byte[] value=Encoding.UTF8.GetBytes(fields[i] ?? "");
                IntPtr data=Marshal.AllocHGlobal(value.Length+2); memory.Add(new KeyValuePair<IntPtr,int>(data,value.Length+2));
                Marshal.WriteInt16(data,(short)value.Length); Marshal.Copy(value,0,IntPtr.Add(data,2),value.Length);
                Array.Clear(value,0,value.Length);
                IntPtr indicator=Marshal.AllocHGlobal(2); memory.Add(new KeyValuePair<IntPtr,int>(indicator,2)); Marshal.WriteInt16(indicator,0);
                IntPtr field=IntPtr.Add(descriptor,20+i*152);
                Marshal.WriteInt16(field,0,449); Marshal.WriteInt16(field,4,4); Marshal.WriteInt16(field,6,(short)Math.Max(1,value.Length));
                Marshal.WriteIntPtr(field,8,data); Marshal.WriteIntPtr(field,12,indicator);
            }
            PanCafeReadOnly.Check(PanCafeReadOnly.isc_dsql_execute(status,ref transaction,ref statement,3,descriptor),status);
            PanCafeReadOnly.Check(isc_commit_transaction(status,ref transaction),status);
        } finally {
            if(statement!=IntPtr.Zero) PanCafeReadOnly.isc_dsql_free_statement(status,ref statement,2);
            if(transaction!=IntPtr.Zero) PanCafeReadOnly.isc_rollback_transaction(status,ref transaction);
            if(db!=IntPtr.Zero) PanCafeReadOnly.isc_detach_database(status,ref db);
            foreach(var block in memory) { Marshal.Copy(new byte[block.Value],0,block.Key,block.Value); Marshal.FreeHGlobal(block.Key); }
            if(descriptor!=IntPtr.Zero) Marshal.FreeHGlobal(descriptor);
        }
    }
}
