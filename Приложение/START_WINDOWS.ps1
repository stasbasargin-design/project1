$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js не найден. Установите Node.js 20 LTS или новее."
}
if (-not $env:PORT) { $env:PORT = "8080" }
Write-Host "Запуск ИТУС на http://localhost:$env:PORT"
node server.mjs
