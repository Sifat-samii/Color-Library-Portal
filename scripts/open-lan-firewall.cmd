@echo off
netsh advfirewall firewall show rule name="Pixofix Color Library 8787" >nul 2>&1
if %errorlevel%==0 exit /b 0
echo Allow inbound TCP 8787 so other computers can open the color library.
powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"Pixofix Color Library 8787\" dir=in action=allow protocol=TCP localport=8787 profile=any' -Verb RunAs -Wait"
