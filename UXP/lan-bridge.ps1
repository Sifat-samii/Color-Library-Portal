$ErrorActionPreference = "Stop"
$listenHost = "127.0.0.1"
$listenPort = 18787
$remoteHost = "192.168.0.112"
$remotePort = 8787

$mutex = New-Object System.Threading.Mutex($false, "PixofixColorLibraryLanBridge")
if (-not $mutex.WaitOne(0)) { exit 0 }

function Start-SequentialProxy {
  $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Parse($listenHost), $listenPort)
  try { $listener.Start() } catch { exit 0 }
  $inBuf = New-Object byte[] 16384
  $outBuf = New-Object byte[] 16384
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $remote = New-Object System.Net.Sockets.TcpClient
    try {
      $remote.Connect($remoteHost, $remotePort)
      $incoming = $client.GetStream()
      $outgoing = $remote.GetStream()
      while ($client.Connected -and $remote.Connected) {
        $moved = $false
        if ($incoming.DataAvailable) {
          $read = $incoming.Read($inBuf, 0, $inBuf.Length)
          if ($read -le 0) { break }
          $outgoing.Write($inBuf, 0, $read)
          $outgoing.Flush()
          $moved = $true
        }
        if ($outgoing.DataAvailable) {
          $read = $outgoing.Read($outBuf, 0, $outBuf.Length)
          if ($read -le 0) { break }
          $incoming.Write($outBuf, 0, $read)
          $incoming.Flush()
          $moved = $true
        }
        if (-not $moved) { Start-Sleep -Milliseconds 1 }
      }
    } catch {
    } finally {
      try { $client.Close() } catch {}
      try { $remote.Close() } catch {}
    }
  }
}

try {
  Add-Type -TypeDefinition @"
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public static class PixofixLanBridge {
  public static void Run(string listenHost, int listenPort, string remoteHost, int remotePort) {
    var listener = new TcpListener(IPAddress.Parse(listenHost), listenPort);
    listener.Start();
    while (true) {
      var client = listener.AcceptTcpClient();
      ThreadPool.QueueUserWorkItem(_ => Handle(client, remoteHost, remotePort));
    }
  }

  static void Handle(TcpClient client, string host, int port) {
    var remote = new TcpClient();
    try {
      remote.Connect(host, port);
      var incoming = client.GetStream();
      var outgoing = remote.GetStream();
      var toRemote = new Thread(() => Pump(incoming, outgoing));
      var toClient = new Thread(() => Pump(outgoing, incoming));
      toRemote.IsBackground = true;
      toClient.IsBackground = true;
      toRemote.Start();
      toClient.Start();
      toRemote.Join();
      toClient.Join();
    } catch {
    } finally {
      try { client.Close(); } catch {}
      try { remote.Close(); } catch {}
    }
  }

  static void Pump(NetworkStream from, NetworkStream to) {
    var buffer = new byte[16384];
    try {
      int read;
      while ((read = from.Read(buffer, 0, buffer.Length)) > 0) {
        to.Write(buffer, 0, read);
        to.Flush();
      }
    } catch {
    }
    try { to.Close(); } catch {}
  }
}
"@
  [PixofixLanBridge]::Run($listenHost, $listenPort, $remoteHost, $remotePort)
} catch {
  Start-SequentialProxy
}
