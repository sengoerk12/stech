using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

public static class PanCafeConnectedTerminals {
    public static byte[] WakePacket(string mac) {
        if (!Regex.IsMatch(mac ?? "", @"\A(?:[0-9a-f]{12}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5}|[0-9a-f]{2}(?::[0-9a-f]{2}){5})\z",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return null;
        byte[] address = PhysicalAddress.Parse(mac.Replace(":", "-").ToUpperInvariant()).GetAddressBytes();
        if (address.Length != 6 || (address[0] & 1) != 0 || Array.TrueForAll(address, value => value == 0)) return null;
        var packet = new byte[102];
        for (int i = 0; i < 6; i++) packet[i] = 255;
        for (int i = 6; i < packet.Length; i += address.Length)
            Buffer.BlockCopy(address, 0, packet, i, address.Length);
        return packet;
    }

    static readonly object historyLock = new object();
    static Dictionary<string,string> historicalMacs = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    static string cachedDatabase;
    static DateTime historyExpires;

    // Only recover an invalid MAC from recent, unambiguous named PanCafe connections.
    public static string WakeAddress(string database, string name, string current) {
        if (WakePacket(current) != null || String.IsNullOrEmpty(name)) return current;
        lock (historyLock) {
            if (cachedDatabase != database || DateTime.UtcNow >= historyExpires) {
                var names = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                var owners = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                var directory = Path.Combine(Directory.GetParent(Path.GetDirectoryName(database)).FullName, "iplogs");
                try {
                    for (int age = 0; age < 7; age++) {
                        string file = Path.Combine(directory, "Log_" + DateTime.Today.AddDays(-age).ToString("ddMMyyyy", CultureInfo.InvariantCulture) + ".csv");
                        if (!File.Exists(file)) continue;
                        using (var stream = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        using (var reader = new StreamReader(stream, Encoding.GetEncoding(1254))) {
                            string line;
                            while ((line = reader.ReadLine()) != null) {
                                var fields = line.Split(';');
                                if (fields.Length < 6 || fields[0] != "Açıldı" || WakePacket(fields[2]) == null) continue;
                                string terminal = fields[1].Trim(), mac = PhysicalAddress.Parse(fields[2].Replace(":", "-").ToUpperInvariant()).ToString();
                                string old;
                                names[terminal] = names.TryGetValue(terminal, out old) && old != mac ? "" : mac;
                                owners[mac] = owners.TryGetValue(mac, out old) && !String.Equals(old, terminal, StringComparison.OrdinalIgnoreCase) ? "" : terminal;
                            }
                        }
                    }
                    historicalMacs.Clear();
                    foreach (var pair in names)
                        if (pair.Value.Length > 0 && String.Equals(owners[pair.Value], pair.Key, StringComparison.OrdinalIgnoreCase))
                            historicalMacs[pair.Key] = pair.Value;
                } catch (IOException) { historicalMacs.Clear(); }
                  catch (UnauthorizedAccessException) { historicalMacs.Clear(); }
                cachedDatabase = database;
                historyExpires = DateTime.UtcNow.AddMinutes(1);
            }
            string saved;
            return historicalMacs.TryGetValue(name, out saved) ? saved : current;
        }
    }
    public static bool Wake(string mac) {
        byte[] packet = WakePacket(mac);
        if (packet == null) return false;
        bool sent = false;
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces()) {
            if (adapter.OperationalStatus != OperationalStatus.Up || adapter.IsReceiveOnly ||
                adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                adapter.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
            foreach (var local in adapter.GetIPProperties().UnicastAddresses) {
                if (local.Address.AddressFamily != AddressFamily.InterNetwork ||
                    local.PrefixLength < 1 || local.PrefixLength > 30 || local.IPv4Mask == null) continue;
                byte[] broadcast = local.Address.GetAddressBytes(), mask = local.IPv4Mask.GetAddressBytes();
                for (int i = 0; i < broadcast.Length; i++) broadcast[i] |= (byte)~mask[i];
                try {
                    using (var udp = new UdpClient(new IPEndPoint(local.Address, 0))) {
                        udp.EnableBroadcast = true;
                        sent |= udp.Send(packet, packet.Length, new IPEndPoint(new IPAddress(broadcast), 9)) == packet.Length;
                    }
                } catch (SocketException) { /* Try the remaining interfaces. */ }
            }
        }
        return sent;
    }

    public static HashSet<string> Read(string database) {
        var connected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        string folder = Directory.GetParent(Path.GetDirectoryName(database)).FullName;
        string logFolder = Path.Combine(folder, "iplogs");
        if (!Directory.Exists(logFolder)) return connected;

        // This installation logs client connections separately from TERMINALSTATUS.
        // An active PanCafe TCP connection must still match the logged client address.
        DateTime since = DateTime.MaxValue;
        foreach (var process in Process.GetProcessesByName("pncserver")) {
            using (process) {
                if (String.Equals(process.MainModule.FileName, Path.Combine(folder, "pncserver.exe"),
                    StringComparison.OrdinalIgnoreCase) && process.StartTime < since)
                    since = process.StartTime;
            }
        }
        if (since == DateTime.MaxValue) return connected;
        var active = new HashSet<IPAddress>();
        foreach (var connection in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpConnections()) {
            if (connection.State == TcpState.Established && connection.LocalEndPoint.Port == 34285)
                active.Add(connection.RemoteEndPoint.Address);
        }
        if (active.Count == 0) return connected;

        var latestByAddress = new Dictionary<IPAddress, string>();
        var addressByName = new Dictionary<string, IPAddress>(StringComparer.OrdinalIgnoreCase);
        for (DateTime day = since.Date; day <= DateTime.Today; day = day.AddDays(1)) {
            string file = Path.Combine(logFolder, "Log_" + day.ToString("ddMMyyyy", CultureInfo.InvariantCulture) + ".csv");
            if (!File.Exists(file)) continue;
            using (var stream = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(stream, Encoding.GetEncoding(1254))) {
                string line;
                while ((line = reader.ReadLine()) != null) {
                    var fields = line.Split(';');
                    DateTime time;
                    IPAddress address;
                    if (fields.Length < 6 || String.IsNullOrWhiteSpace(fields[1]) ||
                        !IPAddress.TryParse(fields[3], out address) ||
                        !DateTime.TryParseExact(fields[4] + " " + fields[5], "dd.MM.yyyy HH:mm:ss",
                            CultureInfo.InvariantCulture, DateTimeStyles.None, out time) || time.AddSeconds(1) <= since)
                        continue;
                    if (fields[0] == "Açıldı") {
                        addressByName[fields[1]] = address;
                        latestByAddress[address] = fields[1];
                    } else if (fields[0] == "Kapandı") {
                        IPAddress previous;
                        if (addressByName.TryGetValue(fields[1], out previous) && previous.Equals(address))
                            addressByName.Remove(fields[1]);
                    }
                }
            }
        }
        foreach (var entry in addressByName) {
            if (active.Contains(entry.Value) && String.Equals(latestByAddress[entry.Value], entry.Key,
                StringComparison.OrdinalIgnoreCase)) connected.Add(entry.Key);
        }
        return connected;
    }
}
