@echo off
cd /d "%~dp0"
title Polka Social
echo Запускаю Polka Social на этом компьютере...
echo Окно нельзя закрывать, пока пользуетесь сайтом.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
echo.
echo Сервер остановился. Если браузер пишет, что 127.0.0.1 не позволяет соединение —
echo процесс не запущен. Запустите start.bat ещё раз и дождитесь Ready.
pause
