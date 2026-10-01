@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 20 LTS или новее.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=8080
echo Запуск ИТУС на http://localhost:%PORT%
node server.mjs
pause
