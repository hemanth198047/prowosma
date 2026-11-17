@echo off
REM Stops everything start-all started - see stop-all.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1" %*
pause
