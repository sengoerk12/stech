using System;

namespace STech.PanCafeBackend
{
    internal static partial class PanCafe
    {
        internal sealed class SessionOutcomeUnknownException:InvalidOperationException
        {
            internal SessionOutcomeUnknownException(Exception error):base("Oturum başlatılmış olabilir. Tekrar denemeden PanCafe’de bilgisayarı kontrol edin. "+error.Message,error){}
        }
    }
}
