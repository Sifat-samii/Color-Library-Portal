@echo off
cd /d "%~dp0"
title Pixofix Color Library
call "%~dp0scripts\open-lan-firewall.cmd"
echo Starting the Pixofix Color Library portal...
echo On this computer, open http://127.0.0.1:8787
echo Other computers open http://192.168.0.112:8787 in a browser
echo Keep this window open. Floor Photoshop panels load the portal the same way a browser does.
npm start
pause
