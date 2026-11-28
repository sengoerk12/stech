using System;
using System.Globalization;

namespace STech.PanCafeBackend
{
    internal static partial class PanCafe
    {
        private static readonly CultureInfo Turkish=CultureInfo.GetCultureInfo("tr-TR");
        internal static bool TryParseAmount(string input,out decimal credit)
        {
            credit=0;
            return input!=null&&Decimal.TryParse(input.Trim().Replace('.',','),NumberStyles.AllowDecimalPoint,Turkish,out credit)&&credit>0&&credit<=999999999.99m&&Decimal.Round(credit,2)==credit;
        }
        internal static string FormatAmount(decimal credit){return credit.ToString("0.##",Turkish);}
        internal sealed class BalanceOutcomeUnknownException:InvalidOperationException
        {
            internal BalanceOutcomeUnknownException(Exception error):base("Bakiye işlemi tamamlanmış olabilir. Yeniden yükleme yapmadan PanCafe üye/kasa hareketlerini kontrol edin. "+error.Message,error){}
        }
    }
}
