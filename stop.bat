@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Prowosma - Stop Backend + Frontend (Windows)
REM ============================================================
REM  Stops whatever is actually listening on the app's ports
REM  (9090 backend, 5173 frontend) rather than relying on window
REM  titles - this works even if the windows were closed manually,
REM  renamed, or started some other way.
REM ============================================================

title Prowosma Stopper

echo ================================================
echo   Prowosma Stopper
echo ================================================
echo.

set STOPPED_ANY=0

call :stop_port 9090 "Backend"
call :stop_port 5173 "Frontend"

REM Also close the leftover terminal windows from start.bat, if any
REM are still open (best-effort - harmless if they're not there).
taskkill /FI "WINDOWTITLE eq Prowosma Backend*"  >nul 2>&1
taskkill /FI "WINDOWTITLE eq Prowosma Frontend*" >nul 2>&1

echo.
if "%STOPPED_ANY%"=="1" (
    echo ================================================
    echo   Done. Prowosma has been stopped.
    echo ================================================
) else (
    echo ================================================
    echo   Nothing was running on ports 9090 or 5173.
    echo   Prowosma wasn't running, or was already stopped.
    echo ================================================
)
echo.
pause
exit /b 0

REM ---------------------------------------------------------
REM  :stop_port <port> <label>
REM  Finds the PID(s) LISTENING on the given port and kills them.
REM ---------------------------------------------------------
:stop_port
set "PORT=%~1"
set "LABEL=%~2"
set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%PORT% "') do (
    set "FOUND=1"
    set "STOPPED_ANY=1"
    echo Stopping %LABEL% (port %PORT%, PID %%P^)...
    taskkill /F /PID %%P >nul 2>&1
    if errorlevel 1 (
        echo   [WARNING] Could not stop PID %%P - it may need to be closed manually.
    ) else (
        echo   [OK] Stopped.
    )
)

if "!FOUND!"=="0" (
    echo %LABEL% ^(port %PORT%^) wasn't running.
)
exit /b 0
