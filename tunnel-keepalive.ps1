$log = "D:\fake-telegram\tunnel-keepalive.log"
$edges = @('3.208.46.244','3.234.18.192','54.172.225.3')
$logfile = "D:\fake-telegram\ssh-live.log"
while ($true) {
    $hostname = $null
    if (Test-Path $logfile) {
        $c = Get-Content $logfile -Raw -ErrorAction SilentlyContinue
        $ms = [regex]::Matches($c, 'https://([\w.-]+\.lhr\.life)')
        if ($ms.Count -gt 0) { $hostname = $ms[$ms.Count - 1].Groups[1].Value }
    }
    $ok = $false
    if ($hostname) {
        foreach ($ip in $edges) {
            try {
                $tcp = [System.Net.Sockets.TcpClient]::new()
                $iar = $tcp.BeginConnect($ip, 443, $null, $null)
                if (-not $iar.AsyncWaitHandle.WaitOne(10000)) { $tcp.Close(); continue }
                $tcp.EndConnect($iar)
                $ssl = [System.Net.Security.SslStream]::new($tcp.GetStream(), $false, { param($s,$c2,$sc,$e) $true })
                $ssl.AuthenticateAsClient($hostname)
                $req = "GET / HTTP/1.1`r`nHost: $hostname`r`nConnection: close`r`nUser-Agent: tunnel-keepalive`r`n`r`n"
                $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
                $ssl.Write($bytes, 0, $bytes.Length)
                $buf = [byte[]]::new(512)
                $n = $ssl.Read($buf, 0, $buf.Length)
                $resp = [System.Text.Encoding]::UTF8.GetString($buf, 0, $n)
                if ($resp -match '200 OK') { $ok = $true }
                $ssl.Dispose(); $tcp.Close()
                if ($ok) { break }
            } catch { }
        }
    }
    $stamp = (Get-Date -Format 'HH:mm:ss')
    if ($ok) { Add-Content $log "$stamp PING $hostname OK" }
    elseif ($hostname) { Add-Content $log "$stamp PING $hostname FAIL (tunnel may be dying)" }
    Start-Sleep -Seconds 40
}