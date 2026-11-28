// Compiled only into the isolated test runner. All executable stubs and objects
// below belong to this test process; no live PanCafe process is opened.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Threading;

namespace STech.PanCafeBackend
{
    internal sealed partial class NativeBridge
    {
        [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr VirtualAlloc(IntPtr address,UIntPtr size,uint allocation,uint protection);
        [DllImport("kernel32.dll")] private static extern bool VirtualFree(IntPtr address,UIntPtr size,uint type);
        internal static int VerifyPhysicalFixture()
        {
            var pages=new List<IntPtr>();var memory=new List<IntPtr>();int checks=0;
            try
            {
                foreach(int address in new[]{0x30000000,0x30010000,0x30020000,0x30030000,0x30040000,0x30050000,0x30060000})
                {
                    IntPtr page=VirtualAlloc(new IntPtr(address),new UIntPtr(65536),0x3000,0x40);
                    if(page==IntPtr.Zero||page.ToInt32()!=address)throw new Exception("Cannot reserve isolated native fixture page "+address.ToString("X8"));pages.Add(page);
                }
                Func<int,IntPtr> allocate=size=>{IntPtr value=Marshal.AllocHGlobal(size);Marshal.Copy(new byte[size],0,value,size);memory.Add(value);return value;};
                Func<string,IntPtr> text=value=>{IntPtr block=allocate(12+(value.Length+1)*2);Marshal.WriteInt32(block,0,0x204b0);Marshal.WriteInt32(block,4,-1);Marshal.WriteInt32(block,8,value.Length);byte[] bytes=System.Text.Encoding.Unicode.GetBytes(value+"\0");Marshal.Copy(bytes,0,IntPtr.Add(block,12),bytes.Length);return IntPtr.Add(block,12);};
                Action<int,byte[]> code=(address,bytes)=>Marshal.Copy(bytes,0,new IntPtr(address),bytes.Length);
                Func<IntPtr,byte[]> immediate=value=>BitConverter.GetBytes(value.ToInt32());
                Action<int,IntPtr> returning=(address,pointer)=>{var bytes=new List<byte>{0xb8};bytes.AddRange(immediate(pointer));bytes.Add(0xc3);code(address,bytes.ToArray());};
                IntPtr member=allocate(1024),terminal=allocate(1024),memberManager=allocate(128),terminalManager=allocate(32),main=allocate(32),data=allocate(2048),table=allocate(512),settings=allocate(32),counter=allocate(32);
                IntPtr ticket=allocate(512),ticketManager=allocate(32),ticketTable=allocate(512);
                Marshal.WriteInt32(ticket,0,0x00990E94);Marshal.WriteInt32(ticket,0x24,77);Marshal.WriteByte(ticket,0x49,1);
                Marshal.WriteInt32(ticketManager,0,0x0099150C);Marshal.WriteIntPtr(data,0x5f0,ticketTable);Marshal.WriteByte(ticketTable,0xa5,1);
                Marshal.WriteInt32(member,0,9986224);Marshal.WriteInt32(member,8,123);Marshal.WriteByte(member,0x31,1);Marshal.WriteIntPtr(member,0x60,text("fixture_member"));Marshal.Copy(BitConverter.GetBytes(50.5),0,IntPtr.Add(member,0x38),8);
                Marshal.WriteInt32(terminal,0,9999948);Marshal.WriteInt32(terminal,0x10,22);Marshal.WriteIntPtr(terminal,0x18,text("00-11-22-33-44-55"));
                Marshal.WriteInt32(memberManager,0,9989140);Marshal.WriteInt32(terminalManager,0,10010300);Marshal.WriteInt32(main,0,16282616);Marshal.WriteIntPtr(data,0x3b8,table);Marshal.WriteByte(table,0xa5,1);
                Action<int,IntPtr> global=(address,value)=>{IntPtr slot=allocate(4);Marshal.WriteIntPtr(slot,value);Marshal.WriteIntPtr(new IntPtr(0x30010000+address-0x01090000),slot);};
                global(0x01092e48,memberManager);global(0x010929d0,terminalManager);global(0x01092338,main);global(0x01092cd8,data);global(0x010939d8,settings);
                global(0x0109247c,ticketManager);returning(0x3003e324,ticket);returning(0x30033b1c,IntPtr.Zero);Marshal.WriteInt32(new IntPtr(0x3006198c),1);
                var ticketReload=new List<byte>{0xff,5};ticketReload.AddRange(immediate(IntPtr.Add(counter,8)));ticketReload.AddRange(new byte[]{0x83,0x3d});ticketReload.AddRange(immediate(IntPtr.Add(counter,16)));ticketReload.AddRange(new byte[]{1,0x75,8,0xc6,0x40,0x48,1,0xc6,0x40,0x4a,1,0xc3});code(0x3003c72c,ticketReload.ToArray());
                var datasetReload=new List<byte>{0xff,5};datasetReload.AddRange(immediate(IntPtr.Add(counter,12)));datasetReload.Add(0xc3);code(0x30059208,datasetReload.ToArray());
                returning(0x30023df8,member);returning(0x30033c4c,terminal);
                code(0x30023164,new byte[]{0xc3});code(0x3004b188,new byte[]{0xb0,1,0xc3});code(0x30002dac,new byte[]{0xb0,1,0xc2,0x10,0});code(0x3000b8ec,new byte[]{0xb0,1,0xc3});
                // StartSession stub checks the real bridge's EAX/EDX/ECX/stack ABI,
                // then simulates server-side session registration exactly once.
                var start=new List<byte>();var jumps=new List<int>();Action mismatch=()=>{start.Add(0x75);jumps.Add(start.Count);start.Add(0);};
                start.Add(0x3d);start.AddRange(immediate(terminal));mismatch();start.AddRange(new byte[]{0x81,0xf9});start.AddRange(immediate(member));mismatch();start.AddRange(new byte[]{0x80,0xfa,5});mismatch();
                foreach(byte offset in new byte[]{4,8,12,16}){start.AddRange(new byte[]{0x83,0x7c,0x24,offset,(byte)(offset==4?1:0)});mismatch();}
                start.AddRange(new byte[]{0xc6,0x40,0x24,5,0x89,0x88,0xc8,0,0,0,0xc7,0x80,0xcc,0,0,0,123,0,0,0,0xc6,0x41,0x50,1,0xff,5});start.AddRange(immediate(counter));start.AddRange(new byte[]{0xc2,0x10,0});
                int failure=start.Count;start.AddRange(new byte[]{0xc7,5});start.AddRange(immediate(IntPtr.Add(counter,4)));start.AddRange(new byte[]{1,0,0,0,0xc2,0x10,0});foreach(int at in jumps)start[at]=checked((byte)(failure-at-1));code(0x30032788,start.ToArray());
                using(var bridge=new NativeBridge(true))
                using(var mapping=MemoryMappedFile.CreateNew(bridge.profile.mapping,2048))
                using(var view=mapping.CreateViewAccessor())
                {
                    if(!bridge.profile.fixture)throw new Exception("Physical fixture requires a fixture-only DLL profile.");
                    IntPtr message=allocate(28);var hook=(HookCallback)Marshal.GetDelegateForFunctionPointer(bridge.callback,typeof(HookCallback));
                    Action reset=()=>{Marshal.WriteByte(member,0x50,0);Marshal.WriteByte(terminal,0x24,1);Marshal.WriteByte(terminal,0x25,0);Marshal.WriteByte(terminal,0x16,0);Marshal.WriteInt32(terminal,0xcc,0);Marshal.WriteInt32(counter,0,0);Marshal.WriteInt32(counter,4,0);code(0x30024e7c,new byte[]{0xb0,1,0xc3});};
                    int fixtureTicketId=0;
                    Func<int,string,NativeReply> request=(operation,mac)=>
                    {
                        view.WriteArray(0,new byte[2048],0,2048);view.Write(0,Magic);view.Write(4,Process.GetCurrentProcess().Id);view.Write(8,operation);view.Write(16,123);view.Write(20,Process.GetCurrentProcess().Id);view.Write(32,22);
                        view.Write(172,fixtureTicketId);
                        StringArgument(view,256,"fixture_member");StringArgument(view,576,"PHYSICAL-PC");StringArgument(view,1120,mac);
                        Marshal.WriteInt32(message,4,(int)bridge.profile.message);Marshal.WriteInt32(message,8,unchecked((int)Magic));Marshal.WriteInt32(message,12,unchecked((int)bridge.profile.tag));hook(0,new IntPtr(1),message);return ReadReply(view);
                    };
                    Action<bool,string> check=(value,reason)=>{if(!value)throw new Exception(reason);checks++;};
                    reset();var offline=request(3,"00-11-22-33-44-55");check(offline.state==2&&offline.wol_enabled==1&&offline.connected_after==0&&Marshal.ReadInt32(counter)==0,"Offline physical preflight must pass without starting.");
                    var started=request(2,"00-11-22-33-44-55");check(started.state==2&&started.login_after==1&&started.terminal_after==5&&started.connected_after==0&&Marshal.ReadInt32(counter)==1&&Marshal.ReadInt32(counter,4)==0,"Offline physical start must reach StartSession once with correct ABI.");
                    var pending=request(4,"00-11-22-33-44-55");check(pending.state==2&&pending.connected_after==0&&Marshal.ReadInt32(counter)==1,"Connection polling must not start twice.");
                    Marshal.WriteByte(terminal,0x25,1);var connected=request(4,"00-11-22-33-44-55");check(connected.state==2&&connected.connected_after==1,"Connected physical session must be observed.");
                    Marshal.WriteInt32(terminal,0xcc,999);var changed=request(4,"00-11-22-33-44-55");check(changed.state==-1&&changed.error==19,"Changed session must not be reported as success.");
                    reset();Marshal.WriteByte(terminal,0x24,0);var closed=request(2,"00-11-22-33-44-55");check(closed.state==2&&closed.terminal_before==0&&closed.terminal_after==5&&Marshal.ReadInt32(counter)==1,"Closed physical terminal must support waking and starting.");
                    reset();Marshal.WriteByte(terminal,0x24,5);var occupied=request(2,"00-11-22-33-44-55");check(occupied.state==-1&&occupied.error==6&&Marshal.ReadInt32(counter)==0,"An occupied physical terminal must remain protected.");
                    reset();var missingMac=request(2,"");check(missingMac.state==-1&&missingMac.error==17&&Marshal.ReadInt32(counter)==0,"Missing MAC must prevent offline start.");
                    reset();code(0x30024e7c,new byte[]{0x30,0xc0,0xc3});var disabled=request(2,"00-11-22-33-44-55");check(disabled.state==-1&&disabled.error==18&&Marshal.ReadInt32(counter)==0,"Disabled WOL must prevent offline start.");
                    reset();Marshal.WriteByte(terminal,0x25,1);code(0x30024e7c,new byte[]{0x30,0xc0,0xc3});var online=request(2,"");check(online.state==2&&online.connected_after==1&&Marshal.ReadInt32(counter)==1,"Online physical sessions do not require WOL/MAC.");
                    reset();Marshal.WriteByte(terminal,0x16,1);code(0x30024e7c,new byte[]{0x30,0xc0,0xc3});var virtualPc=request(2,"");check(virtualPc.state==2&&virtualPc.is_virtual==1&&Marshal.ReadInt32(counter)==1,"Virtual sessions must remain supported.");
                    // Exercise the actual native ticket branch and continuation event.
                    reset();Marshal.WriteInt32(counter,8,0);Marshal.WriteInt32(counter,12,0);
                    using(var continuation=new EventWaitHandle(false,EventResetMode.ManualReset,bridge.profile.continuation))
                    {
                        view.WriteArray(0,new byte[2048],0,2048);view.Write(0,Magic);view.Write(4,Process.GetCurrentProcess().Id);view.Write(8,1);view.Write(16,123);view.Write(20,Process.GetCurrentProcess().Id);view.Write(172,77);
                        StringArgument(view,256,"fixture_member");Marshal.WriteInt32(message,4,(int)bridge.profile.message);Marshal.WriteInt32(message,8,unchecked((int)Magic));Marshal.WriteInt32(message,12,unchecked((int)bridge.profile.tag));
                        Exception workerError=null;
                        var worker=new Thread(()=>{try{hook(0,new IntPtr(1),message);}catch(Exception error){workerError=error;}});worker.Start();
                        try
                        {
                            var deadline=Stopwatch.StartNew();while(view.ReadInt32(12)!=10&&deadline.ElapsedMilliseconds<5000)Thread.Sleep(1);
                            check(view.ReadInt32(12)==10&&ClaimCredit(view),"Ticket native handshake must be claimed before the transaction.");
                            Marshal.WriteInt32(counter,16,1);view.Write(96,50.5);view.Write(44,1);continuation.Set();
                        }
                        finally{continuation.Set();if(!worker.Join(5000))throw new Exception("Native ticket fixture did not release its thread.");}
                        if(workerError!=null)throw workerError;
                        var reply=ReadReply(view);
                        check(reply.state==2&&reply.stage==240&&Marshal.ReadInt32(counter,8)==2&&Marshal.ReadInt32(counter,12)==2,"Ticket model and both browsing datasets must reload after commit.");
                    }
                    fixtureTicketId=77;Marshal.WriteByte(ticketTable,0xa5,2);
                    var editingTicket=request(1,"");check(editingTicket.state==-1&&editingTicket.error==9,"An edited ticket dataset must reject before monetary SQL can be claimed.");
                    Marshal.WriteByte(ticketTable,0xa5,1);Marshal.WriteByte(ticket,0x49,0);
                    var wrongKind=request(1,"");check(wrongKind.state==-1&&wrongKind.error==20,"A non-member-credit cached ticket must reject before SQL.");
                }
                return checks;
            }
            finally{foreach(IntPtr pointer in memory)Marshal.FreeHGlobal(pointer);foreach(IntPtr page in pages)VirtualFree(page,UIntPtr.Zero,0x8000);}
        }
    }
}
