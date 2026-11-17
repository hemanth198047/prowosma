@echo off
REM Starts MongoDB, speech-to-text, backend and frontend - see start-all.ps1. Options: -LocalAI  -NoSpeech  -NoBrowser  -Yes
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" %*
if errorlevel 1 pause
