$log = "D:\fake-telegram\cf-tunnel.log"
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel --url http://localhost:1458" -RedirectStandardOutput $log -RedirectStandardError "$log-err" -WorkingDirectory "D:\fake-telegram" -WindowStyle Hidden | Out-Null
