@echo off
set PATH=%PATH%;C:\Windows\System32\OpenSSH
ssh -o StrictHostKeyChecking=no -o HostKeyAlias=localhost.run -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -R 80:localhost:1458 nokey@54.82.85.249
