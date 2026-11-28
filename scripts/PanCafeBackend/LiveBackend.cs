using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace STech.PanCafeBackend
{
    internal interface ILiveBackend : IDisposable
    {
        MemberRecord Member(string username);
        TerminalRecord Terminal(string name);
        NativeReply Invoke(int operation,MemberRecord member,TerminalRecord terminal,decimal amount,string journalId,CreditRequest credit);
    }

    internal sealed class HookBackend : ILiveBackend
    {
        private readonly NativeBridge bridge;
        internal HookBackend(string database,string client){bridge=new NativeBridge(database,client);}
        public MemberRecord Member(string username){return bridge.Database.FindMember(username);}
        public TerminalRecord Terminal(string name){return bridge.Database.FindTerminal(name);}
        public NativeReply Invoke(int operation,MemberRecord member,TerminalRecord terminal,decimal amount,string journalId,CreditRequest credit)
        {return bridge.Execute(operation,member,terminal,amount,null,0,journalId,credit);}
        public void Dispose(){bridge.Dispose();}
    }

    // Shared with the proven Controller backend, so both programs serialize hooks
    // and Firebird transactions. This has no mouse/keyboard activity condition.
    internal sealed class BackendLease : IDisposable
    {
        private readonly Mutex mutex;
        internal readonly bool Acquired;
        internal BackendLease()
        {
            mutex=new Mutex(false,@"Local\PanCafeBalanceCredit");
            try{Acquired=mutex.WaitOne(0);}catch(AbandonedMutexException){Acquired=true;}
        }
        public void Dispose(){if(Acquired)mutex.ReleaseMutex();mutex.Dispose();}
    }

    internal static class BackendStorage
    {
        internal static string JournalId(string database,string kind,string operation)
        {
            string installation=NativeBridge.Hash(Encoding.UTF8.GetBytes(Path.GetFullPath(database).ToUpperInvariant())).Substring(0,16);
            return installation+"-"+kind+"-"+Guid.Parse(operation).ToString("N");
        }
        internal static OperationJournal Journal(string id)
        {
            string file=Path.Combine(OperationJournal.DirectoryPath,id+".json");
            if(!File.Exists(file))return null;
            var journal=new JavaScriptSerializer().Deserialize<OperationJournal>(File.ReadAllText(file));
            if(journal==null||journal.id!=id)throw new InvalidDataException("Native işlem günlüğü eşleşmiyor.");
            journal.FilePath=file;return journal;
        }
        internal static void FinishJournal(string id,string status)
        {var journal=Journal(id);if(journal!=null)journal.Save(status);}

        internal static void Save(string path,object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            byte[] bytes=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value));
            using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None))
            {file.Write(bytes,0,bytes.Length);file.Flush(true);}
            if(File.Exists(path))File.Replace(temporary,path,null);else File.Move(temporary,path);
        }
        internal static T Read<T>(string path)
        {
            using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
            using(var reader=new StreamReader(stream))return new JavaScriptSerializer().Deserialize<T>(reader.ReadToEnd());
        }
        internal static bool OlderThan(string value,TimeSpan age)
        {
            DateTime time;
            return !DateTime.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out time)||DateTime.UtcNow-time.ToUniversalTime()>=age;
        }
    }
}
