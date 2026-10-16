@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
if %ERRORLEVEL% NEQ 0 pause
echo.
echo Чтобы запустить сайт, выполните:
echo   npm run dev
echo Затем откройте http://localhost:3000
pause
