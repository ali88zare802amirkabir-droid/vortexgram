@echo off
cloudflared tunnel --url http://localhost:1458 --protocol http2 --edge-ip-version 4 > "D:\fake-telegram\cf-live.log" 2>&1
