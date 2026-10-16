$ErrorActionPreference = "Stop"

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "Polka Social: установка окружения для Windows" -ForegroundColor Cyan

if (-not (Test-Command "git")) {
  Write-Host "Git не найден. Устанавливаю Git..."
  winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
}

if (-not (Test-Command "node")) {
  Write-Host "Node.js не найден. Устанавливаю Node.js LTS..."
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Write-Host ""
  Write-Host "Node.js установлен. Закройте это окно, откройте новый PowerShell и снова запустите setup-windows.ps1" -ForegroundColor Yellow
  exit 0
}

$nodeVersion = node -v
Write-Host "Найден Node.js $nodeVersion"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (Test-Path (Join-Path $root ".git")) {
  git fetch origin
  git checkout cursor/saas-stage-one-ee77
  git pull origin cursor/saas-stage-one-ee77
}

Write-Host "Устанавливаю зависимости npm..."
npm install

Write-Host ""
Write-Host "Готово. Запуск:" -ForegroundColor Green
Write-Host "  npm run dev"
Write-Host "Затем откройте http://localhost:3000"
