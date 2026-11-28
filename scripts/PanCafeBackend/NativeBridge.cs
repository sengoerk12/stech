using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace STech.PanCafeBackend
{
    internal sealed class NativeReply
    {
        public int state,error,stage,login_before,login_after,terminal_before,terminal_after,terminal_id,operator_id;
        public int is_virtual,connected_before,connected_after,wol_enabled;
        public decimal balance_before,balance_after;
        internal OperationJournal PendingSession;
    }
    internal sealed class OperationJournal
    {
        public string id,kind,username,database,status,created_utc,error;
        public int member_id,terminal_id;
        public decimal amount;
        public CreditReceipt receipt;
        internal string FilePath;
        internal static readonly string DirectoryPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"STech","PanCafe","Operations");
        internal static void CheckPending(int memberId,string database,string replayId=null)
        {
            if(!Directory.Exists(DirectoryPath))return;
            foreach(string path in Directory.GetFiles(DirectoryPath,"*.json"))
            {
                OperationJournal old;
                try{old=NativeBridge.Json.Deserialize<OperationJournal>(File.ReadAllText(path));}
                catch(Exception e){throw new InvalidOperationException("Önceki işlem günlüğü okunamadı: "+path,e);}
                if(old.id!=replayId&&old.member_id==memberId&&String.Equals(old.database,database,StringComparison.OrdinalIgnoreCase)&&old.status!="complete"&&old.status!="failed")
                    throw new PanCafe.BalanceOutcomeUnknownException(new InvalidOperationException("Bu üyenin önceki işlemi doğrulama bekliyor. Günlük: "+path));
            }
        }
        internal void Save(string newStatus)
        {
            status=newStatus;Directory.CreateDirectory(DirectoryPath);
            string temporary=FilePath+"."+Guid.NewGuid().ToString("N")+".tmp";
            byte[] bytes=Encoding.UTF8.GetBytes(NativeBridge.Json.Serialize(this));
            using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)){file.Write(bytes,0,bytes.Length);file.Flush(true);}
            if(File.Exists(FilePath))File.Replace(temporary,FilePath,null);else File.Move(temporary,FilePath);
        }
    }
    internal sealed class NativeCommandRejectedException : InvalidOperationException
    {
        internal readonly int Code;
        internal NativeCommandRejectedException(int code,string message):base(message){Code=code;}
    }
    internal sealed partial class NativeBridge : IDisposable
    {
        internal static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
        private const uint Magic=0x50434d32;
#pragma warning disable 0649
        private sealed class Profile {public int schema;public bool fixture;public string mapping,continuation,dll_sha256,exe_sha256;public uint tag,message;}
#pragma warning restore 0649
        private readonly Profile profile;
        private readonly IntPtr module,callback;
        private readonly FileStream moduleFile;
        private readonly Process target;
        private readonly uint thread;
        private static IntPtr firebirdModule;
        private static string firebirdPath;
        internal readonly ControllerDatabase Database;
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32.dll",CharSet=CharSet.Ansi,SetLastError=true)] private static extern IntPtr GetProcAddress(IntPtr module,string name);
        [DllImport("kernel32.dll")] private static extern bool FreeLibrary(IntPtr module);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] bytes,int count,out IntPtr got);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool SetDllDirectory(string path);
        [DllImport("user32.dll",SetLastError=true)] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
        [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
        [DllImport("user32.dll",SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int type,IntPtr callback,IntPtr module,uint thread);
        [DllImport("user32.dll",SetLastError=true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll",SetLastError=true)] private static extern bool PostThreadMessage(uint thread,uint message,UIntPtr wp,IntPtr lp);
        [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate IntPtr HookCallback(int code,IntPtr wp,IntPtr lp);
        internal static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");}
        private static byte[] Resource(string name)
        {
            using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if(stream==null)throw new InvalidOperationException("Native köprü kaynağı eksik: "+name);
                using(var output=new MemoryStream()){stream.CopyTo(output);return output.ToArray();}
            }
        }
        private static Process FindTarget()
        {
            Process selected=null;
            foreach(var process in Process.GetProcessesByName("pncserver"))
            {
                if(process.MainWindowHandle!=IntPtr.Zero&&process.MainWindowTitle=="PanCafe Pro")
                {
                    if(selected!=null){selected.Dispose();process.Dispose();throw new InvalidOperationException("Birden fazla PanCafe ana penceresi açık.");}
                    selected=process;
                }
                else process.Dispose();
            }
            if(selected==null)throw new InvalidOperationException("PanCafe Pro açık değil. PanCafe’yi açıp tekrar deneyin.");
            return selected;
        }
        private static void CheckCode(Process process)
        {
            uint[] addresses={0x00993164,0x009A2788,0x00C7B188,0x00FE2DAC,0x00FEB8EC,0x006D9208,0x009A2AC0,0x00993DF8,0x009A3B1C,0x009A3C4C,0x00994E7C,0x00FBEB4C,0x00981F68,0x009AE324,0x009AC72C};
            string[] signatures={"E8-87-F5-FF-FF-C3-8B-C0","55-8B-EC-53-56-57-8B-F9","53-51-88-14-24-8B-D8-8B","55-8B-EC-83-C4-F0-53-56","55-8B-EC-83-C4-F0-53-56","55-8B-EC-51-89-45-FC-8B","53-8B-D8-8B-C3-E8-16-78","55-8B-EC-83-C4-F4-53-56","55-8B-EC-83-C4-F4-53-56","55-8B-EC-83-C4-F4-53-56","55-8B-EC-51-53-56-8B-D9","55-8B-EC-33-C9-51-51-51","55-8B-EC-83-C4-E0-53-56"};
            Array.Resize(ref signatures,15);signatures[13]="55-8B-EC-83-C4-F8-53-56";signatures[14]="55-8B-EC-33-C9-51-51-51";
            IntPtr handle=OpenProcess(0x410,false,process.Id);if(handle==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
            try{for(int i=0;i<addresses.Length;i++){byte[] bytes=new byte[8];IntPtr read;if(!ReadProcessMemory(handle,new IntPtr(addresses[i]),bytes,8,out read)||read.ToInt64()!=8||BitConverter.ToString(bytes)!=signatures[i])throw new InvalidOperationException("PanCafe işlevleri doğrulanan sürümle eşleşmiyor; işlem yapılmadı.");}}
            finally{CloseHandle(handle);}
        }
        internal NativeBridge() : this(false) { }
        private NativeBridge(bool localTest)
        {
            if(IntPtr.Size!=4)throw new InvalidOperationException("Native köprü x86 derlenmeli.");
            try
            {
                profile=Json.Deserialize<Profile>(Encoding.UTF8.GetString(Resource("ControllerBackend.profile")));
                if(profile.schema!=5||(!localTest&&profile.fixture))throw new InvalidOperationException("Köprü protokolü uyumsuz.");
                byte[] dll=Resource("ControllerBackend.x86.dll");
                if(Hash(dll)!=profile.dll_sha256)throw new InvalidOperationException("Native köprü bütünlüğü doğrulanamadı.");
                string directory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"STech","PanCafe","Native",profile.dll_sha256);
                Directory.CreateDirectory(directory);string file=Path.Combine(directory,"ControllerBackend.x86.dll");
                if(!File.Exists(file))using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.Read)){output.Write(dll,0,dll.Length);output.Flush(true);}
                moduleFile=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read);
                byte[] actual=new byte[moduleFile.Length];int offset=0;while(offset<actual.Length){int read=moduleFile.Read(actual,offset,actual.Length-offset);if(read==0)throw new EndOfStreamException();offset+=read;}
                if(Hash(actual)!=profile.dll_sha256)throw new InvalidOperationException("Kaydedilen native DLL değiştirilmiş.");
                module=LoadLibrary(file);if(module==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
                callback=GetProcAddress(module,"BackendHook");if(callback==IntPtr.Zero)throw new InvalidOperationException("Native giriş noktası bulunamadı.");
                if(localTest)return;
                target=FindTarget();string exe=target.MainModule.FileName;
                if(target.MainModule.BaseAddress.ToInt64()!=0x400000||Hash(File.ReadAllBytes(exe))!=profile.exe_sha256)throw new InvalidOperationException("Bu PanCafe sürümü desteklenmiyor. Doğrulanan sürüm: 3.3.2.312.");
                CheckCode(target);
                uint pid;thread=GetWindowThreadProcessId(target.MainWindowHandle,out pid);
                if(thread==0||pid!=target.Id)throw new InvalidOperationException("PanCafe iş parçacığı doğrulanamadı.");
                if(!IsWindowEnabled(target.MainWindowHandle))throw new InvalidOperationException("PanCafe’deki açık iletişim kutusunu tamamlayıp tekrar deneyin.");
                ConfigureFirebird(Path.Combine(Path.GetDirectoryName(exe),"Core"));
                Database=new ControllerDatabase(Path.Combine(Path.GetDirectoryName(exe),@"Data\USDB.DAT"));
            }
            catch{Dispose();throw;}
        }
        internal NativeBridge(string expectedDatabase,string expectedClient) : this(false)
        {
            try
            {
                string core=Path.Combine(Path.GetDirectoryName(target.MainModule.FileName),"Core");
                if(!String.Equals(Path.GetFullPath(Database.Path),Path.GetFullPath(expectedDatabase),StringComparison.OrdinalIgnoreCase)||
                   !String.Equals(Path.GetFullPath(core).TrimEnd('\\'),Path.GetFullPath(expectedClient).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Çalışan PanCafe ile S TECH veritabanı/motor yapılandırması eşleşmiyor; işlem yapılmadı.");
            }
            catch{Dispose();throw;}
        }
        internal static void ConfigureFirebird(string directory)
        {
            string library=Path.Combine(directory,"fbembed.dll");
            if(!File.Exists(library))throw new FileNotFoundException("PanCafe Firebird motoru bulunamadı.",library);
            if(firebirdModule!=IntPtr.Zero){if(firebirdPath!=library)throw new InvalidOperationException("Farklı Firebird kurulumları aynı işlemde kullanılamaz.");return;}
            if(!SetDllDirectory(directory))throw new Win32Exception(Marshal.GetLastWin32Error());
            Environment.SetEnvironmentVariable("FIREBIRD",directory);Environment.SetEnvironmentVariable("FIREBIRD_TMP",Path.GetTempPath());
            Environment.SetEnvironmentVariable("FIREBIRD_LOCK",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"firebird"));
            firebirdModule=LoadLibrary(library);if(firebirdModule==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());firebirdPath=library;
        }
        private static void StringArgument(MemoryMappedViewAccessor view,int position,string value)
        {
            view.Write(position-12,0x000204b0);view.Write(position-8,-1);view.Write(position-4,value.Length);
            byte[] data=Encoding.Unicode.GetBytes(value+"\0");view.WriteArray(position,data,0,data.Length);
        }
        private static NativeReply ReadReply(MemoryMappedViewAccessor view)
        {
            return new NativeReply{state=view.ReadInt32(12),error=view.ReadInt32(36),stage=view.ReadInt32(40),login_before=view.ReadInt32(52),login_after=view.ReadInt32(56),terminal_before=view.ReadInt32(60),terminal_after=view.ReadInt32(64),terminal_id=view.ReadInt32(116),operator_id=view.ReadInt32(72),is_virtual=view.ReadInt32(68),connected_before=view.ReadInt32(160),connected_after=view.ReadInt32(164),wol_enabled=view.ReadInt32(168),balance_before=Convert.ToDecimal(view.ReadDouble(80)),balance_after=Convert.ToDecimal(view.ReadDouble(88))};
        }
        private static unsafe bool ClaimCredit(MemoryMappedViewAccessor view)
        {
            byte* pointer=null;view.SafeMemoryMappedViewHandle.AcquirePointer(ref pointer);
            try{return Interlocked.CompareExchange(ref *(int*)(pointer+12),11,10)==10;}
            finally{view.SafeMemoryMappedViewHandle.ReleasePointer();}
        }
        internal NativeReply Execute(int operation,MemberRecord member,TerminalRecord terminal,decimal amount,IProgress<string> progress,int verificationMode=0,string operationId=null,CreditRequest credit=null)
        {
            OperationJournal journal=null;bool committed=false,commitAttempted=false,posted=false,verifiedNoop=false;Exception transactionFailure=null;
            if((operation==1||operation==2)&&verificationMode==0)
            {
                OperationJournal.CheckPending(member.Id,Database.Path,operation==1&&credit!=null?operationId:null);
                journal=new OperationJournal{id=operationId??Guid.NewGuid().ToString("N"),kind=operation==1?"credit":"session",username=member.Username,member_id=member.Id,terminal_id=terminal==null?0:terminal.Id,database=Database.Path,amount=amount,created_utc=DateTime.UtcNow.ToString("o")};
                journal.FilePath=Path.Combine(OperationJournal.DirectoryPath,journal.id+".json");
            }
            IntPtr hook=IntPtr.Zero;
            using(var mapping=MemoryMappedFile.CreateNew(profile.mapping,2048))
            using(var view=mapping.CreateViewAccessor(0,2048,MemoryMappedFileAccess.ReadWrite))
            using(var continuation=new EventWaitHandle(false,EventResetMode.ManualReset,profile.continuation))
            {
                view.Write(0,Magic);view.Write(4,target.Id);view.Write(8,operation);view.Write(16,member.Id);view.Write(20,Process.GetCurrentProcess().Id);view.Write(32,terminal==null?0:terminal.Id);view.Write(104,(double)amount);
                if(credit!=null)view.Write(172,credit.TicketId);
                StringArgument(view,256,member.Username);StringArgument(view,576,terminal==null?"":terminal.Name);
                StringArgument(view,1120,terminal!=null&&ControllerDatabase.IsUsableMac(terminal.Mac)?terminal.Mac:"");
                try
                {
                    if(journal!=null)journal.Save("prepared");
                    hook=SetWindowsHookEx(3,callback,module,thread);if(hook==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
                    if(!PostThreadMessage(thread,profile.message,new UIntPtr(Magic),new IntPtr(unchecked((int)profile.tag))))throw new Win32Exception(Marshal.GetLastWin32Error());
                    posted=true;
                    var timer=Stopwatch.StartNew();
                    while(true)
                    {
                        int state=view.ReadInt32(12);
                        if(state==10&&operation==1)
                        {
                            if(!ClaimCredit(view))throw new InvalidOperationException("Bakiye isteğinin süresi doldu; bakiye eklenmedi.");
                            try
                            {
                                if(verificationMode!=0)
                                {
                                    var snapshot=ReadReply(view);Database.VerifyLockedSnapshot(member.Id,snapshot.balance_before,snapshot.login_before);
                                    if(verificationMode==2){view.Write(96,(double)snapshot.balance_before);verifiedNoop=true;}
                                    timer.Restart();continue;
                                }
                                if(progress!=null)progress.Report("Bakiye ve hareket kayıtları işleniyor…");
                                var before=ReadReply(view);
                                journal.receipt=Database.AddCredit(member,amount,before.balance_before,before.login_before,before.terminal_id,before.operator_id,journal.id,
                                    receipt=>{if(view.ReadInt32(12)!=11)throw new InvalidOperationException("PanCafe işlem bağlamı değişti.");journal.receipt=receipt;view.Write(96,(double)receipt.balance_after);journal.Save("committing");commitAttempted=true;},
                                    ()=>{committed=true;},credit);
                                journal.Save("committed");
                            }
                            catch(Exception e){transactionFailure=e;}
                            finally{view.Write(44,committed||verifiedNoop?1:-1);continuation.Set();}
                            timer.Restart();
                        }
                        if(state==2||state<0)break;
                        if(target.HasExited)throw new InvalidOperationException("PanCafe işlem sırasında kapandı.");
                        if(timer.ElapsedMilliseconds>15000)throw new TimeoutException("PanCafe komutunun sonucu zamanında alınamadı.");
                        Thread.Sleep(10);
                    }
                    NativeReply result=ReadReply(view);
                    if(transactionFailure!=null)throw transactionFailure;
                    if(verificationMode==1&&result.state==-1&&result.error==15)return result;
                    if(result.state!=2)throw new NativeCommandRejectedException(result.error,ErrorMessage(result.error));
                    if(operation==2)Database.VerifySession(member.Id,terminal.Id);
                    if(journal!=null)
                    {
                        if(operation==2&&result.is_virtual==0&&result.connected_after==0){journal.Save("waiting_for_client");result.PendingSession=journal;}
                        else journal.Save("complete");
                    }
                    return result;
                }
                catch(Exception e)
                {
                    int stage=view.ReadInt32(40);
                    int state=view.ReadInt32(12);
                    bool unknown=committed||commitAttempted||(operation==2&&(stage>=100||(posted&&(state==0||state==1))));
                    if(journal!=null){journal.error=e.Message;try{journal.Save(unknown?"unknown":"failed");}catch(Exception logError){if(!posted)throw new InvalidOperationException("İşlem günlüğü kaydedilemedi; PanCafe’ye istek gönderilmedi.",new AggregateException(e,logError));throw new PanCafe.BalanceOutcomeUnknownException(new AggregateException(e,logError));}}
                    if(unknown){if(operation==2)throw new PanCafe.SessionOutcomeUnknownException(e);throw new PanCafe.BalanceOutcomeUnknownException(e);}
                    throw;
                }
                finally
                {
                    // A failed controller operation must release a waiting native callback.
                    if(view.ReadInt32(44)==0){view.Write(44,-1);continuation.Set();}
                    if(hook!=IntPtr.Zero)UnhookWindowsHookEx(hook);
                }
            }
        }
        internal NativeReply WaitForSessionConnection(NativeReply registered,MemberRecord member,TerminalRecord terminal,IProgress<string> progress)
        {
            if(registered.PendingSession==null)return registered;
            var journal=registered.PendingSession;
            var clock=Stopwatch.StartNew();
            try
            {
                NativeReply connected=SessionConnectionWaiter.Wait(registered,()=>Execute(4,member,terminal,0,null),()=>clock.ElapsedMilliseconds,Thread.Sleep,progress,terminal.Name,180000);
                Database.VerifySession(member.Id,terminal.Id);journal.Save("complete");return connected;
            }
            catch(Exception error)
            {
                journal.error=error.Message;
                try{journal.Save("unknown");}catch(Exception logError){throw new PanCafe.SessionOutcomeUnknownException(new AggregateException(error,logError));}
                throw new PanCafe.SessionOutcomeUnknownException(error);
            }
        }
        private static string ErrorMessage(int code)
        {
            switch(code)
            {
                case 2:return "Üye çalışan PanCafe belleğinde bulunamadı.";
                case 3:return "PanCafe nesne kimliği veya sürümü uyuşmuyor; işlem yapılmadı.";
                case 4:return "PanCafe’deki operatörün bu işlem için yetkisi yok.";
                case 5:return "Üye hesabı aktif değil.";
                case 6:return "Üye zaten oturumda veya bilgisayar kullanımda.";
                case 8:return "Bonus sistemi açık. Bu sürüm bonuslu yüklemeyi desteklemiyor.";
                case 9:return "PanCafe’deki üye düzenleme işlemini tamamlayıp tekrar deneyin.";
                case 10:return "Üye ile açık oturumun bellekteki bağlantısı uyuşmuyor.";
                case 11:return "Bilgisayar çalışan PanCafe belleğinde bulunamadı.";
                case 12:return "PanCafe bu üyenin bakiyesi veya tarifesiyle oturum açılmasına izin vermedi.";
                case 13:return "PanCafe oturum kapasitesi kontrolü başarısız oldu.";
                case 14:return "PanCafe ile işlem bağlantısı tamamlanamadı.";
                case 15:return "Veritabanı işlemi tamamlanmadı; yükleme yapılmadı.";
                case 16:return "İşlem sonrası PanCafe belleği doğrulanamadı.";
                case 17:return "Kapalı bilgisayarı açmak için PanCafe’de geçerli, güncel bir MAC adresi kayıtlı olmalı.";
                case 18:return "PanCafe’de oturum başlatırken Wake-on-LAN kullanma ayarı kapalı.";
                case 19:return "Bilgisayarın bağlanması beklenirken üye veya terminal oturumu değişti.";
                case 20:return "Bilet çalışan PanCafe belleğinde doğrulanamadı veya kullanımda.";
                default:return "PanCafe işlemi reddedildi ("+code+").";
            }
        }
        internal static void ProtocolSelfTest()
        {
            using(var bridge=new NativeBridge(true))
            using(var mapping=MemoryMappedFile.CreateNew(bridge.profile.mapping,2048))
            using(var view=mapping.CreateViewAccessor())
            {
                IntPtr message=Marshal.AllocHGlobal(28);
                try
                {
                    var hook=(HookCallback)Marshal.GetDelegateForFunctionPointer(bridge.callback,typeof(HookCallback));
                    view.Write(0,Magic);view.Write(4,Process.GetCurrentProcess().Id);view.Write(8,99);view.Write(20,Process.GetCurrentProcess().Id);
                    Marshal.Copy(new byte[28],0,message,28);Marshal.WriteInt32(message,4,(int)bridge.profile.message);Marshal.WriteInt32(message,8,unchecked((int)Magic));Marshal.WriteInt32(message,12,unchecked((int)bridge.profile.tag));
                    hook(0,new IntPtr(1),message);if(view.ReadInt32(12)!=2)throw new Exception("Native protocol round trip failed.");
                    view.Write(12,0);view.Write(8,98);Marshal.WriteInt32(message,4,(int)bridge.profile.message);Marshal.WriteInt32(message,8,unchecked((int)Magic));Marshal.WriteInt32(message,12,unchecked((int)bridge.profile.tag));
                    hook(0,new IntPtr(1),message);if(view.ReadInt32(12)!=-1||view.ReadInt32(36)!=1)throw new Exception("Unknown native operation was not rejected.");
                    view.Write(12,10);if(!ClaimCredit(view)||view.ReadInt32(12)!=11||ClaimCredit(view))throw new Exception("Credit ownership must be claimed once.");
                    view.Write(12,0);view.Write(8,99);Marshal.WriteInt32(message,4,(int)bridge.profile.message);Marshal.WriteInt32(message,8,unchecked((int)Magic));Marshal.WriteInt32(message,12,unchecked((int)bridge.profile.tag));
                    hook(0,IntPtr.Zero,message);if(view.ReadInt32(12)!=0)throw new Exception("Peek without removal was consumed.");
                    view.Write(4,Process.GetCurrentProcess().Id+100000);hook(0,new IntPtr(1),message);if(view.ReadInt32(12)!=0)throw new Exception("Wrong target PID was accepted.");
                }
                finally{Marshal.FreeHGlobal(message);}
            }
        }
        public void Dispose(){if(module!=IntPtr.Zero)FreeLibrary(module);if(moduleFile!=null)moduleFile.Dispose();if(target!=null)target.Dispose();}
    }
}
