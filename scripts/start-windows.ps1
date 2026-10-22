$ErrorActionPreference = "Stop"

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Polka Social: запуск на этом компьютере" -ForegroundColor Cyan
Write-Host "Браузер должен открывать http://localhost:3000 на ЭТОМ ПК."
Write-Host "127.0.0.1 без запущенного npm не откроется — это не сайт в интернете."
Write-Host ""

if (-not (Test-Command "node")) {
  Write-Host "Node.js не найден. Сначала запустите setup.bat" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "Ставлю npm-зависимости..."
  npm install
}

$envFile = Join-Path $root ".env"
$example = Join-Path $root ".env.example"
if (-not (Test-Path $envFile)) {
  if (-not (Test-Path $example)) {
    Write-Host "Нет .env.example" -ForegroundColor Red
    exit 1
  }
  Copy-Item $example $envFile
  Write-Host "Создан .env из примера."
}

$secret = (node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
$envText = Get-Content $envFile -Raw
if ($envText -match "AUTH_SECRET=replace-with" -or $envText -match "AUTH_SECRET=\s*$") {
  $envText = [regex]::Replace($envText, "AUTH_SECRET=.*", "AUTH_SECRET=$secret")
  Set-Content -Path $envFile -Value $envText -NoNewline
  Write-Host "В .env записан случайный AUTH_SECRET."
}

if (-not (Test-Command "docker")) {
  Write-Host ""
  Write-Host "Docker не найден. Для PostgreSQL нужен Docker Desktop:" -ForegroundColor Yellow
  Write-Host "  https://www.docker.com/products/docker-desktop/"
  Write-Host "Установите, запустите Docker Desktop (кит в трее) и снова нажмите start.bat."
  exit 1
}

try {
  docker info | Out-Null
} catch {
  Write-Host "Docker установлен, но демон не запущен. Откройте Docker Desktop и подождите, пока он стартует." -ForegroundColor Yellow
  exit 1
}

Write-Host "Поднимаю PostgreSQL (docker compose)..."
docker compose up -d postgres

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  docker compose exec -T postgres pg_isready -U polka -d polka_social 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
}

if (-not $ready) {
  Write-Host "PostgreSQL не ответил за 60 секунд. Проверьте Docker Desktop." -ForegroundColor Red
  exit 1
}

Write-Host "Применяю миграции..."
npx prisma migrate deploy

Write-Host ""
Write-Host "Сервер стартует. Не закрывайте это окно." -ForegroundColor Green
Write-Host "Когда появится Ready, откройте:" -ForegroundColor Green
Write-Host "  http://localhost:3000"
Write-Host "Письма подтверждения: http://localhost:3000/dev/mailbox"
Write-Host "Проверка: http://localhost:3000/api/health"
Write-Host ""

npm run dev -- --hostname 127.0.0.1 --port 3000
