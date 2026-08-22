$ErrorActionPreference = "Stop"

$port = "1458"
$dir = $PSScriptRoot
$logDir = Join-Path $env:TEMP "fake-telegram"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host "Starting fake-telegram server on port $port ..."
$env:PORT = $port
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "server.log") -RedirectStandardError (Join-Path $logDir "server-err.log")

Start-Sleep -Seconds 3
try {
  $resp = Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing -TimeoutSec 5
  Write-Host "Server is UP (HTTP $($resp.StatusCode)): http://localhost:$port"
} catch {
  Write-Host "Server failed to start. Check: $(Join-Path $logDir 'server-err.log')"
  exit 1
}

Write-Host "Starting Cloudflare tunnel ..."
$cfArgs = @("tunnel", "--url", "http://localhost:$port")
Start-Process -FilePath "C:\Program Files (x86)\cloudflared\cloudflared.exe" -ArgumentList $cfArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "cf.log") -RedirectStandardError (Join-Path $logDir "cf-err.log")

Start-Sleep -Seconds 8
$url = Select-String -Path (Join-Path $logDir "cf.log"), (Join-Path $logDir "cf-err.log") -Pattern "https://[\w-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1

if ($url) {
  Write-Host "Tunnel is UP: $url"
  Set-Content -Path (Join-Path $logDir "url.txt") -Value $url
  Write-Host "Share this URL with your friend. Logs: $logDir"
} else {
  Write-Host "Tunnel starting... check later: $(Get-Content (Join-Path $logDir 'cf-err.log') | Select-String 'trycloudflare')"
}