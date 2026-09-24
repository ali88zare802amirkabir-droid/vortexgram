$pingLog  = "D:\fake-telegram\tunnel-keepalive.log"
$guardLog = "D:\fake-telegram\tunnel-guard.log"
$sshLog   = "D:\fake-telegram\ssh-live.log"
$urlFile  = "D:\fake-telegram\tunnel-url.txt"
$statusFile = "D:\fake-telegram\tunnel-status.txt"
$bat      = "D:\fake-telegram\run-ssh.bat"

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content $guardLog "$stamp tunnel-guard v3 started"

function Server-Alive {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    try {
        $iar = $tcp.BeginConnect('127.0.0.1', 1458, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(4000)) { return $false }
        $tcp.EndConnect($iar)
        return $true
    } catch { return $false }
    finally { try { $tcp.Close() } catch {} }
}

function Restart-Server {
    $stamp = Get-Date -Format 'HH:mm:ss'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'server\.js' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Start-Process cmd.exe -ArgumentList @('/c','set PORT=1458&& cd /d D:\fake-telegram && node server.js >> D:\fake-telegram\server-live.log 2>&1')
    Add-Content $guardLog "$stamp node server relaunched"
}

function Get-LiveUrl {
    if (Test-Path $sshLog) {
        $c = Get-Content $sshLog -Raw -ErrorAction SilentlyContinue
        $clean = $c -replace '\x1b\[[0-9;]*[A-Za-z]', ''
        $ms = [regex]::Matches($clean, 'https://([\w.-]+\.lhr\.life)')
        if ($ms.Count -gt 0) { return "https://$($ms[$ms.Count-1].Groups[1].Value)" }
    }
    return $null
}

function Resolve-Edges([string]$hostname) {
    $ips = @()
    foreach ($srv in @('8.8.8.8','1.1.1.1')) {
        try {
            $r = Resolve-DnsName -Name $hostname -Server $srv -Type A -ErrorAction Stop | Where-Object { $_.IPAddress }
            if ($r) { $ips += @($r.IPAddress) }
        } catch { }
    }
    return ($ips | Select-Object -Unique)
}

# returns 'ok' | 'warn' (any HTTP status) | 'dead'
function Test-Tunnel([string]$url) {
    $hostname = $url -replace 'https://',''
    $edges = Resolve-Edges $hostname
    foreach ($ip in $edges) {
        $code = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 12 --resolve ("{0}:443:{1}" -f $hostname, $ip) $url 2>$null
        if ($code -eq '200') { return 'ok' }
    }
    $code = & curl.exe -sS -o NUL -w "%{http_code}" --max-time 12 $url 2>$null
    if ($code -match '^\d{3}$') { return 'warn' }
    return 'dead'
}

function Start-Tunnel {
    try {
        Start-Process cmd.exe -ArgumentList "/c $bat >> $sshLog 2>&1" -ErrorAction Stop
        return $true
    } catch {
        Add-Content $guardLog "$(Get-Date -Format 'HH:mm:ss') Start-Tunnel ERROR: $($_.Exception.Message)"
        return $false
    }
}

$failCount = 0
$relaunchWait = 15
$sshSeen = ''
while ($true) {
    $stamp = Get-Date -Format 'HH:mm:ss'

    if (-not (Server-Alive)) {
        Add-Content $guardLog "$stamp LOCAL SERVER DOWN - restarting node"
        Restart-Server
        Start-Sleep -Seconds 6
    }

    $running = (Get-Process -Name ssh -ErrorAction SilentlyContinue | Measure-Object).Count

    if ($running -eq 0) {
        $stamp = Get-Date -Format 'HH:mm:ss'
        Add-Content $guardLog "$stamp ssh down - relaunching (backoff $relaunchWait s)"
        Set-Content $statusFile "DOWN - guard relaunching (no live tunnel right now)"
        Start-Tunnel
        Start-Sleep -Seconds 12
        $after = (Get-Process -Name ssh -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($after -eq 0) {
            Add-Content $guardLog "$stamp relaunch did not survive - sleeping $relaunchWait s"
            Start-Sleep -Seconds $relaunchWait
            if ($relaunchWait -lt 240) { $relaunchWait = 240 }
        } else {
            $relaunchWait = 15
        }
        continue
    } else {
        $relaunchWait = 15
    }

    $url = Get-LiveUrl
    if (-not $url) {
        Add-Content $pingLog "$stamp NO_URL (ssh running)"
        Start-Sleep -Seconds 15
        continue
    }

    if ($url -ne $sshSeen) {
        Add-Content $guardLog "$stamp new URL registered: $url"
        $sshSeen = $url
    }

    $r = Test-Tunnel $url
    if ($r -eq 'ok') {
        $failCount = 0
        Set-Content $urlFile $url
        Set-Content $statusFile "OK - $url"
        Add-Content $pingLog "$stamp PING $($url -replace 'https://','') OK"
    } elseif ($r -eq 'warn') {
        Add-Content $pingLog "$stamp PING $($url -replace 'https://','') WARN (HTTP $code)"
        $failCount = [Math]::Max(0, $failCount - 1)
    } else {
        $failCount++
        Add-Content $pingLog "$stamp PING $($url -replace 'https://','') DEAD ($failCount)"
        if ($failCount -ge 2) {
            Add-Content $guardLog "$stamp tunnel dead ($failCount) - force-restart ssh"
            Get-Process -Name ssh -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            $failCount = 0
        }
    }
    Start-Sleep -Seconds 20
}