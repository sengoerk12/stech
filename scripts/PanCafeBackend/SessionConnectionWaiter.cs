using System;

namespace STech.PanCafeBackend
{
    internal static class SessionConnectionWaiter
    {
        internal static NativeReply Wait(NativeReply registered,Func<NativeReply> readStatus,Func<long> milliseconds,Action<int> delay,IProgress<string> progress,string computer,int timeout)
        {
            if(registered.is_virtual!=0||registered.connected_after!=0)return registered;
            if(timeout<=0)throw new ArgumentOutOfRangeException("timeout");
            long until=milliseconds()+timeout;
            if(progress!=null)progress.Report(computer+" için açılış isteği gönderildi; PanCafe istemcisi bekleniyor…");
            while(milliseconds()<until)
            {
                long remaining=until-milliseconds();
                if(remaining<=0)break;
                delay((int)Math.Min(1000,remaining));
                var status=readStatus();
                if(status.state!=2||status.login_after!=1||status.terminal_after!=5||status.terminal_id!=registered.terminal_id)throw new InvalidOperationException("Beklenen üye oturumu bilgisayarda korunmuyor.");
                if(status.connected_after!=0)return status;
                if(progress!=null)progress.Report(computer+" açılıyor; istemcinin PanCafe’ye bağlanması bekleniyor…");
            }
            throw new TimeoutException(computer+" için açılış isteği gönderildi, ancak istemci 3 dakika içinde bağlanmadı. PanCafe’de bilgisayarın durumunu kontrol edin.");
        }
    }
}
