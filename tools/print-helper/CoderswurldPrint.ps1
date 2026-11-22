# Coderswurld Print Helper
# Prints receipts from the Coderswurld web app straight to your receipt printer,
# with no print window. Keep it running on the till computer.
# It only listens on this computer (127.0.0.1) and only accepts Coderswurld pages.

$ErrorActionPreference = "Stop"
$source = @'
// Coderswurld Print Helper.
// A tiny local server on 127.0.0.1:17777 that takes a receipt from the
// Coderswurld web app and sends it straight to a receipt printer, with no
// print window. Bytes go to the printer as RAW (ESC/POS), so the printer uses
// its own sharp built-in font. Only listens on this computer, and only accepts
// requests from Coderswurld pages.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CwRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

    /// Send bytes to a Windows printer exactly as they are (RAW).
    public static void Send(string printer, byte[] data)
    {
        IntPtr h;
        if (!OpenPrinter(printer, out h, IntPtr.Zero))
            throw new Exception("Can't open printer \"" + printer + "\": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        try
        {
            var info = new DocInfo { pDocName = "Coderswurld receipt", pDataType = "RAW" };
            if (StartDocPrinter(h, 1, info) == 0)
                throw new Exception("The printer refused the job: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            try
            {
                StartPagePrinter(h);
                int written;
                if (!WritePrinter(h, data, data.Length, out written) || written != data.Length)
                    throw new Exception("Couldn't send the receipt to the printer: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
                EndPagePrinter(h);
            }
            finally { EndDocPrinter(h); }
        }
        finally { ClosePrinter(h); }
    }

    /// A network receipt printer (most listen on port 9100).
    public static void SendNetwork(string host, int port, byte[] data)
    {
        using (var c = new TcpClient())
        {
            var connect = c.BeginConnect(host, port, null, null);
            if (!connect.AsyncWaitHandle.WaitOne(4000)) throw new Exception("No printer answered at " + host + ":" + port + ". Check the IP address and that it is on the same network.");
            c.EndConnect(connect);
            using (var s = c.GetStream()) { s.Write(data, 0, data.Length); s.Flush(); }
        }
    }
}

public static class CwServer
{
    public const string Version = "1.0.0";
    public const int Port = 17777;

    static string J(string s)
    {
        if (s == null) return "null";
        var b = new StringBuilder("\"");
        foreach (var ch in s)
        {
            if (ch == '"' || ch == '\\') b.Append('\\').Append(ch);
            else if (ch < 32) b.Append("\\u").Append(((int)ch).ToString("x4"));
            else b.Append(ch);
        }
        return b.Append('"').ToString();
    }

    /// Only Coderswurld pages (and local development) may print.
    static bool AllowedOrigin(string origin)
    {
        if (string.IsNullOrEmpty(origin)) return false;
        Uri u;
        if (!Uri.TryCreate(origin, UriKind.Absolute, out u)) return false;
        var host = u.Host.ToLowerInvariant();
        if (host == "localhost" || host == "127.0.0.1") return true;
        if (u.Scheme != "https") return false;
        if (host == "coderswurld.com" || host.EndsWith(".coderswurld.com")) return true;
        if (host.EndsWith(".vercel.app") && host.Contains("coderswurld")) return true;
        return false;
    }

    static string PrintersJson()
    {
        var items = new List<string>();
        string def = null;
        try { def = new System.Drawing.Printing.PrinterSettings().PrinterName; } catch { }
        try
        {
            using (var q = new ManagementObjectSearcher("SELECT Name, PortName, DriverName, WorkOffline, PrinterStatus FROM Win32_Printer"))
            {
                foreach (ManagementObject p in q.Get())
                {
                    var name = (p["Name"] ?? "").ToString();
                    var port = (p["PortName"] ?? "").ToString();
                    var driver = (p["DriverName"] ?? "").ToString();
                    var offline = p["WorkOffline"] is bool && (bool)p["WorkOffline"];
                    var status = p["PrinterStatus"] == null ? 0 : Convert.ToInt32(p["PrinterStatus"]);
                    int jobs = 0;
                    try
                    {
                        using (var jq = new ManagementObjectSearcher("SELECT Name FROM Win32_PrintJob WHERE Name LIKE '" + name.Replace("'", "''").Replace("\\", "\\\\") + ",%'"))
                            jobs = jq.Get().Count;
                    }
                    catch { }
                    items.Add("{\"name\":" + J(name) + ",\"port\":" + J(port) + ",\"driver\":" + J(driver) +
                              ",\"offline\":" + (offline ? "true" : "false") + ",\"status\":" + status +
                              ",\"waitingJobs\":" + jobs + ",\"isDefault\":" + (name == def ? "true" : "false") + "}");
                }
            }
        }
        catch
        {
            foreach (string name in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                items.Add("{\"name\":" + J(name) + ",\"isDefault\":" + (name == def ? "true" : "false") + "}");
        }
        return "[" + string.Join(",", items.ToArray()) + "]";
    }

    static Dictionary<string, string> Query(string target)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var i = target.IndexOf('?');
        if (i < 0) return d;
        foreach (var pair in target.Substring(i + 1).Split('&'))
        {
            var kv = pair.Split(new[] { '=' }, 2);
            if (kv.Length == 2) d[Uri.UnescapeDataString(kv[0])] = Uri.UnescapeDataString(kv[1].Replace('+', ' '));
        }
        return d;
    }

    static void Reply(NetworkStream s, int code, string reason, string origin, string body, string type)
    {
        var bytes = Encoding.UTF8.GetBytes(body ?? "");
        var h = new StringBuilder();
        h.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
        if (AllowedOrigin(origin))
        {
            h.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
            h.Append("Vary: Origin\r\n");
            h.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            h.Append("Access-Control-Allow-Headers: content-type\r\n");
            h.Append("Access-Control-Allow-Private-Network: true\r\n");
            h.Append("Access-Control-Max-Age: 600\r\n");
        }
        h.Append("Content-Type: ").Append(type).Append("\r\n");
        h.Append("Cache-Control: no-store\r\n");
        h.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
        h.Append("Connection: close\r\n\r\n");
        var head = Encoding.ASCII.GetBytes(h.ToString());
        s.Write(head, 0, head.Length);
        s.Write(bytes, 0, bytes.Length);
    }

    static void Handle(TcpClient client)
    {
        using (client)
        using (var s = client.GetStream())
        {
            client.ReceiveTimeout = 8000;
            client.SendTimeout = 8000;
            // Read headers.
            var buf = new List<byte>();
            int b, end = -1;
            while ((b = s.ReadByte()) != -1)
            {
                buf.Add((byte)b);
                int n = buf.Count;
                if (n >= 4 && buf[n - 4] == 13 && buf[n - 3] == 10 && buf[n - 2] == 13 && buf[n - 1] == 10) { end = n; break; }
                if (n > 16384) return;
            }
            if (end < 0) return;
            var head = Encoding.ASCII.GetString(buf.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = head[0].Split(' ');
            if (first.Length < 2) return;
            string method = first[0], target = first[1], origin = null;
            int length = 0;
            foreach (var line in head)
            {
                var c = line.IndexOf(':');
                if (c <= 0) continue;
                var k = line.Substring(0, c).Trim().ToLowerInvariant();
                var v = line.Substring(c + 1).Trim();
                if (k == "origin") origin = v;
                else if (k == "content-length") int.TryParse(v, out length);
            }
            if (length < 0 || length > 4 * 1024 * 1024) { Reply(s, 413, "Too Large", origin, "{\"ok\":false,\"error\":\"Receipt too large.\"}", "application/json"); return; }
            var body = new byte[length];
            int read = 0;
            while (read < length) { int r = s.Read(body, read, length - read); if (r <= 0) break; read += r; }

            var path = target.Split('?')[0];
            if (method == "OPTIONS") { Reply(s, 204, "No Content", origin, "", "text/plain"); return; }

            // Browsers always send Origin on cross-site calls; refuse other sites.
            if (origin != null && !AllowedOrigin(origin))
            {
                Reply(s, 403, "Forbidden", origin, "{\"ok\":false,\"error\":\"This website may not use the printer.\"}", "application/json");
                return;
            }

            try
            {
                if (method == "GET" && (path == "/" || path == "/status"))
                {
                    Reply(s, 200, "OK", origin, "{\"ok\":true,\"app\":\"coderswurld-print\",\"version\":" + J(Version) + ",\"printers\":" + PrintersJson() + "}", "application/json");
                }
                else if (method == "POST" && path == "/print")
                {
                    if (origin == null) { Reply(s, 403, "Forbidden", origin, "{\"ok\":false,\"error\":\"Missing origin.\"}", "application/json"); return; }
                    var q = Query(target);
                    string host, printer;
                    if (q.TryGetValue("host", out host) && host.Length > 0)
                    {
                        int port = 9100;
                        string p;
                        if (q.TryGetValue("port", out p)) int.TryParse(p, out port);
                        CwRawPrinter.SendNetwork(host, port, body);
                    }
                    else
                    {
                        if (!q.TryGetValue("printer", out printer) || printer.Length == 0)
                            printer = new System.Drawing.Printing.PrinterSettings().PrinterName;
                        CwRawPrinter.Send(printer, body);
                    }
                    Reply(s, 200, "OK", origin, "{\"ok\":true}", "application/json");
                }
                else Reply(s, 404, "Not Found", origin, "{\"ok\":false,\"error\":\"Not found.\"}", "application/json");
            }
            catch (Exception ex)
            {
                Reply(s, 500, "Error", origin, "{\"ok\":false,\"error\":" + J(ex.Message) + "}", "application/json");
            }
        }
    }

    /// Blocks forever, serving one request at a time on its own thread.
    public static void Run()
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        try { listener.Start(); }
        catch (SocketException) { throw new Exception("Port " + Port + " is busy. The print helper is probably already running."); }
        Console.WriteLine("Coderswurld Print Helper " + Version + " is running on http://127.0.0.1:" + Port);
        Console.WriteLine("Keep this running while you sell. Close this window to stop it.");
        while (true)
        {
            var c = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(_ => { try { Handle(c); } catch (Exception e) { Console.WriteLine(e.Message); } });
        }
    }
}

'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing, System.Management
    [CwServer]::Run()
} catch {
    Write-Host ""
    Write-Host "Coderswurld Print Helper could not start:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
}
