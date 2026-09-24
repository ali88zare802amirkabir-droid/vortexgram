@echo off
ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o connecttimeout=12 -o ServerAliveInterval=30 -R 80:localhost:1458 vortexgram@54.82.85.249 2>&1
