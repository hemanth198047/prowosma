@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Prowosma - Start Backend + Frontend (Windows)
REM ============================================================
REM  Put this file anywhere near your project. It searches for
REM  the backend (gradlew.bat) and frontend (package.json) project
REM  folders itself, so exact placement doesn't matter.
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SEARCH_ROOT=%ROOT%"
title Prowosma Launcher

echo ================================================
echo   Prowosma Launcher
echo ================================================
echo   Searching under: %SEARCH_ROOT%
echo ================================================
echo.

REM ---------------------------------------------------------
REM Step 0: Check prerequisites
REM ---------------------------------------------------------
where java >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java was not found on this machine.
    echo         Install JDK 21 from https://adoptium.net/temurin/releases/?version=21
    echo         then close this window and run start.bat again.
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this machine.
    echo         Install it from https://nodejs.org ^(LTS version^)
    echo         then close this window and run start.bat again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found ^(it normally installs together with Node.js^).
    echo         Try reinstalling Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [OK] Java found.
echo [OK] Node.js / npm found.

if not defined MONGODB_URI (
    echo.
    echo [TIP] No MONGODB_URI found - this looks like it might be your
    echo       first time running this. If you have a MongoDB Atlas ^(or
    echo       other cloud^) connection string to use, run setup-mongodb.bat
    echo       instead - it walks you through connecting it, just once.
    echo       Continuing with a local MongoDB default for now...
    echo.
)
echo.

REM ---------------------------------------------------------
REM Step 1: Locate the backend project folder (contains gradlew.bat)
REM
REM  Uses "dir /s /b" to do the recursive search (reliable - this is
REM  the exact mechanism that correctly found the real nested path
REM  during diagnostics), then strips the filename off the end of
REM  the result using delayed-expansion string substitution rather
REM  than the %%~dp modifier.
REM ---------------------------------------------------------
echo Looking for the backend project (gradlew.bat)...
set "BACKEND_DIR="
for /f "delims=" %%F in ('dir /s /b "%SEARCH_ROOT%\gradlew.bat" 2^>nul') do (
    if not defined BACKEND_DIR (
        set "FULLPATH=%%F"
        set "BACKEND_DIR=!FULLPATH:\gradlew.bat=!"
    )
)

if not defined BACKEND_DIR (
    echo [ERROR] Could not find gradlew.bat anywhere under:
    echo         %SEARCH_ROOT%
    echo         Make sure the extracted backend project is somewhere
    echo         inside this folder, then run start.bat again.
    echo.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\gradlew.bat" (
    echo [ERROR] Resolved backend path doesn't check out:
    echo         %BACKEND_DIR%\gradlew.bat
    echo         Here is everything named gradlew.bat that actually
    echo         exists under %SEARCH_ROOT%:
    dir /s /b "%SEARCH_ROOT%\gradlew.bat" 2>nul
    echo.
    pause
    exit /b 1
)
echo [OK] Backend project found at: %BACKEND_DIR%
echo.

REM ---------------------------------------------------------
REM Step 2: Locate the frontend project folder (contains package.json,
REM         ignoring anything already inside a node_modules folder)
REM ---------------------------------------------------------
echo Looking for the frontend project (package.json)...
set "FRONTEND_DIR="
set "SKIPPED_ANY=0"
for /f "delims=" %%F in ('dir /s /b "%SEARCH_ROOT%\package.json" 2^>nul') do (
    set "CANDIDATE=%%F"
    echo !CANDIDATE! | findstr /i "node_modules" >nul
    if errorlevel 1 (
        if not defined FRONTEND_DIR (
            REM Only accept this candidate if it actually defines a "dev"
            REM script - a stray/incomplete package.json elsewhere under
            REM SEARCH_ROOT (e.g. left over from an accidental `npm init`,
            REM or a different tool's package.json) would otherwise "win"
            REM just by being found first, even though it's not the real
            REM frontend project.
            findstr /c:"\"dev\":" "%%F" >nul 2>&1
            if not errorlevel 1 (
                set "FULLPATH=%%F"
                set "FRONTEND_DIR=!FULLPATH:\package.json=!"
            ) else (
                set "SKIPPED_ANY=1"
                echo   [SKIP] !CANDIDATE! ^(no "dev" script^)
            )
        )
    )
)

if not defined FRONTEND_DIR (
    if "!SKIPPED_ANY!"=="1" (
        echo [ERROR] Found package.json file^(s^) under %SEARCH_ROOT%, but
        echo         none of them define a "dev" script, so none is the
        echo         real frontend project folder. See the [SKIP] lines
        echo         above for what was found and rejected.
        echo.
        pause
        exit /b 1
    )
    echo [ERROR] Could not find a frontend package.json ^(outside node_modules^) under:
    echo         %SEARCH_ROOT%
    echo         Make sure the extracted frontend project is somewhere
    echo         inside this folder, then run start.bat again.
    echo.
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo [ERROR] Resolved frontend path doesn't check out:
    echo         %FRONTEND_DIR%\package.json
    echo         Here is everything named package.json that actually
    echo         exists under %SEARCH_ROOT% ^(excluding node_modules^):
    dir /s /b "%SEARCH_ROOT%\package.json" 2>nul | findstr /v /i "node_modules"
    echo.
    pause
    exit /b 1
)
echo [OK] Frontend project found at: %FRONTEND_DIR%
echo.

REM ---------------------------------------------------------
REM Step 3: Bootstrap the backend - downloads Gradle + all Java
REM         dependencies on first run.
REM ---------------------------------------------------------
echo ================================================
echo   Preparing backend dependencies (first run may take a while)
echo ================================================
pushd "%BACKEND_DIR%"
if errorlevel 1 (
    echo [ERROR] Could not switch into %BACKEND_DIR%
    pause
    exit /b 1
)
call gradlew.bat --version
if errorlevel 1 (
    echo.
    echo [ERROR] Gradle wrapper failed to bootstrap. Check your internet
    echo         connection ^(it needs to download Gradle + dependencies
    echo         the first time^) and try again.
    popd
    pause
    exit /b 1
)
popd
echo [OK] Backend build tool ready.
echo.

REM ---------------------------------------------------------
REM Step 4: Install frontend dependencies
REM ---------------------------------------------------------
echo ================================================
echo   Installing frontend dependencies
echo ================================================
pushd "%FRONTEND_DIR%"
if errorlevel 1 (
    echo [ERROR] Could not switch into %FRONTEND_DIR%
    pause
    exit /b 1
)
call npm install --no-audit --no-fund --legacy-peer-deps
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and
    echo         try running start.bat again.
    popd
    pause
    exit /b 1
)
popd
echo [OK] Frontend dependencies installed.
echo.

REM ---------------------------------------------------------
REM Step 5: Start the backend in its own window
REM ---------------------------------------------------------
echo ================================================
echo   Starting backend (Spring Boot, port 9090)
echo ================================================
start "Prowosma Backend" cmd /k "cd /d "%BACKEND_DIR%" && gradlew.bat bootRun"

REM ---------------------------------------------------------
REM Step 6: Wait until the backend is actually responding
REM ---------------------------------------------------------
echo Waiting for the backend to finish starting...
set READY=0
set /a WAITCOUNT=0

:waitloop
set /a WAITCOUNT+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:9090/swagger-ui.html' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    set READY=1
    goto waitdone
)
if !WAITCOUNT! GEQ 60 goto waitdone
timeout /t 2 /nobreak >nul
goto waitloop

:waitdone
if "!READY!"=="1" (
    echo [OK] Backend is up and responding.
) else (
    echo [WARNING] Backend did not respond within 2 minutes.
    echo           Check the "Prowosma Backend" window for errors.
    echo           Continuing to start the frontend anyway...
)
echo.

REM ---------------------------------------------------------
REM Step 7: Start the frontend in its own window
REM ---------------------------------------------------------
echo ================================================
echo   Starting frontend (Vite, port 5173)
echo ================================================
start "Prowosma Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

echo.
echo ================================================
echo   Prowosma is starting up
echo ================================================
echo   Backend:   http://localhost:9090
echo   Swagger:   http://localhost:9090/swagger-ui.html
echo   Frontend:  http://localhost:5173
echo ================================================
echo.
echo Two terminal windows have opened - one for the backend, one for
echo the frontend. Leave both running while you use the app. Close
echo both windows (or press Ctrl+C in each) to stop the app.
echo.
pause
