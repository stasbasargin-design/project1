@echo off
cd /d "%~dp0"
set PORT=8081
start "" http://localhost:8081/preview.html
node server.mjs
pause
