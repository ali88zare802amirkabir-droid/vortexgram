$log = "D:\fake-telegram\cf-tunnel2.log"
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel --url http://localhost:1458 --protocol http2" -RedirectStandardOutput $log -RedirectStandardError "$log-err" -WorkingDirectory "D:\fake-telegram" -WindowStyle Hidden | Out-Null
