@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
if %ERRORLEVEL% NEQ 0 pause
echo.
echo Установка закончена. Теперь дважды нажмите start.bat
echo и откройте http://localhost:3000  (обязательно с портом 3000)
pause
