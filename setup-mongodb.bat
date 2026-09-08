@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  Prowosma - One-Click Environment Setup (Windows)
REM ============================================================
REM  For first-time setup of a Development, Staging, or Production
REM  environment. Walks through pointing THIS machine/deployment
REM  at a MongoDB database (a fresh MongoDB Atlas cluster, an
REM  existing self-hosted MongoDB, or a local install), then
REM  starts the backend just long enough to prove the connection
REM  works and to let it create every collection and index the
REM  app needs (this happens automatically on startup - see
REM  MongoIndexConfig.java - so there is nothing to run manually
REM  inside MongoDB itself).
REM
REM  Run this ONCE per machine/deployment (e.g. once on your dev
REM  laptop, once on your staging server, once on your production
REM  server - each is a separate run, since each is a separate
REM  machine talking to a separate database). After that, use
REM  start.bat as normal - it will remember the settings this
REM  script saves.
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
title Prowosma - Environment Setup

echo ================================================
echo   Prowosma - One-Click Environment Setup
echo ================================================
echo.
echo   This will:
echo     1. Ask which environment this machine is for
echo     2. Ask for your MongoDB connection details
echo     3. Start the backend briefly to connect and verify it
echo     4. Confirm every collection and index was created
echo     5. Hand off to start.bat to launch it ^(Dev/Staging only^)
echo.
echo   Run this once per machine - start.bat will reuse these
echo   settings on every future run on that same machine.
echo ================================================
echo.

REM ---------------------------------------------------------
REM Step 0: Check prerequisites (same checks as start.bat)
REM ---------------------------------------------------------
where java >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java was not found on this machine.
    echo         Install JDK 21 from https://adoptium.net/temurin/releases/?version=21
    echo         then close this window and run setup-mongodb.bat again.
    echo.
    pause
    exit /b 1
)
echo [OK] Java found.
echo.

REM ---------------------------------------------------------
REM Step 1: Which environment is THIS machine for?
REM ---------------------------------------------------------
echo ------------------------------------------------
echo   Which environment is this machine for?
echo ------------------------------------------------
echo.
echo   [1] Development  - your own local testing ^(default^)
echo   [2] Staging      - a pre-production environment for
echo                      final testing before real customers
echo   [3] Production   - real, paying customers
echo.
echo   Each environment should point at its OWN MongoDB database
echo   ^(ideally its own Atlas cluster, or at least its own database
echo   name within a shared cluster while you're small^) - never
echo   share one database between Staging and Production. See the
echo   notes below for why.
echo.
set "ENV_CHOICE="
set /p "ENV_CHOICE=Enter 1, 2, or 3 (or press ENTER for Development): "
if "%ENV_CHOICE%"=="" set "ENV_CHOICE=1"

set "SPRING_PROFILE="
set "ENV_LABEL="
set "ALLOW_LOCAL_DEFAULT=1"
set "DEFAULT_DB=prowosma"
set "REQUIRE_EXTRAS=0"

if "%ENV_CHOICE%"=="1" (
    set "ENV_LABEL=Development"
)
if "%ENV_CHOICE%"=="2" (
    set "SPRING_PROFILE=staging"
    set "ENV_LABEL=Staging"
    set "ALLOW_LOCAL_DEFAULT=0"
    set "DEFAULT_DB=prowosma_staging"
    set "REQUIRE_EXTRAS=1"
)
if "%ENV_CHOICE%"=="3" (
    set "SPRING_PROFILE=prod"
    set "ENV_LABEL=Production"
    set "ALLOW_LOCAL_DEFAULT=0"
    set "DEFAULT_DB=prowosma_prod"
    set "REQUIRE_EXTRAS=1"
)

if not defined ENV_LABEL (
    echo [ERROR] "%ENV_CHOICE%" isn't a valid option. Run this script again
    echo         and enter 1, 2, or 3.
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] Setting up: %ENV_LABEL%
echo.

REM Extra confirmation gate for Production specifically - this is the one
REM environment where a mistake affects real customers, so it gets an
REM explicit "are you sure" rather than just quietly proceeding.
if "%ENV_CHOICE%"=="3" (
    echo ------------------------------------------------
    echo   You're setting up PRODUCTION.
    echo ------------------------------------------------
    echo   This environment should point at a database that real
    echo   customers' data will live in. Make sure:
    echo     - You have a dedicated MongoDB Atlas cluster ^(or at
    echo       minimum a dedicated database^) for Production only -
    echo       never shared with Staging or Development.
    echo     - Its Network Access list only allows your actual
    echo       production server's IP - not 0.0.0.0/0.
    echo     - You have a real domain ready for FRONTEND_URL/CORS
    echo       ^(the questions below will ask for it^).
    echo.
    set "PROD_CONFIRM="
    set /p "PROD_CONFIRM=Type YES to continue: "
    if /i not "!PROD_CONFIRM!"=="YES" (
        echo.
        echo Cancelled. Nothing was changed.
        pause
        exit /b 0
    )
    echo.
)

REM ---------------------------------------------------------
REM Step 2: MongoDB connection string
REM ---------------------------------------------------------
echo ------------------------------------------------
echo   Where is your MongoDB for %ENV_LABEL%?
echo ------------------------------------------------
echo.
echo   If you're using MongoDB Atlas ^(the free/managed cloud
echo   option^), copy the connection string from Atlas:
echo     Database -^> Connect -^> Drivers -^> copy the string
echo     starting with "mongodb+srv://"
echo.

if "%ALLOW_LOCAL_DEFAULT%"=="1" (
    echo   If you're running MongoDB on this same machine, or don't
    echo   have a connection string yet, just press ENTER to use a
    echo   local default ^(mongodb://localhost:27017^).
    echo.
    set "MONGO_URI_INPUT="
    set /p "MONGO_URI_INPUT=Paste your connection string (or press ENTER for local): "
    if "!MONGO_URI_INPUT!"=="" (
        set "MONGODB_URI=mongodb://localhost:27017"
        echo.
        echo [OK] Using local MongoDB at mongodb://localhost:27017
    ) else (
        set "MONGODB_URI=!MONGO_URI_INPUT!"
        echo.
        echo [OK] Using the connection string you provided.
    )
    goto mongoUriDone
)

echo   %ENV_LABEL% needs a real MongoDB connection string - it
echo   should NOT point at a local database on this machine.
echo   For real scale, use a dedicated Atlas cluster ^(ideally
echo   its own Atlas Project^) for %ENV_LABEL% specifically,
echo   separate from your other environments.
echo.
:askMongoUri
set "MONGO_URI_INPUT="
set /p "MONGO_URI_INPUT=Paste your %ENV_LABEL% connection string: "
if "!MONGO_URI_INPUT!"=="" (
    echo [ERROR] A connection string is required for %ENV_LABEL%.
    goto askMongoUri
)
set "MONGODB_URI=!MONGO_URI_INPUT!"
echo.
echo [OK] Using the connection string you provided.

:mongoUriDone
echo.

REM ---------------------------------------------------------
REM Step 3: Database name
REM ---------------------------------------------------------
echo ------------------------------------------------
echo   What should the database be called?
echo ------------------------------------------------
echo.
echo   This keeps %ENV_LABEL%'s data separate from any other
echo   environment, even if they share the same MongoDB cluster.
echo   It does not need to exist yet - it will be created
echo   automatically. Press ENTER to use "%DEFAULT_DB%".
echo.
set "MONGO_DB_INPUT="
set /p "MONGO_DB_INPUT=Database name (or press ENTER for '%DEFAULT_DB%'): "
if "%MONGO_DB_INPUT%"=="" (
    set "MONGO_DB=%DEFAULT_DB%"
) else (
    set "MONGO_DB=%MONGO_DB_INPUT%"
)
echo [OK] Database name: %MONGO_DB%
echo.

REM ---------------------------------------------------------
REM Steps 4-6: Staging/Production also need a real frontend URL,
REM CORS origins, and JWT secret - application-staging.properties
REM and application-prod.properties both refuse to start without
REM these (see those files for why), so this script collects them
REM up front rather than letting the client hit a raw Java error.
REM ---------------------------------------------------------
if "%REQUIRE_EXTRAS%"=="0" goto skipExtras

echo ------------------------------------------------
echo   Where will your frontend be reachable?
echo ------------------------------------------------
echo.
echo   The real URL people will visit for %ENV_LABEL%, e.g.
echo   https://app.yourcompany.com - used to build links in
echo   emails ^(invitations, password resets^).
echo.
:askFrontendUrl
set "FRONTEND_URL_INPUT="
set /p "FRONTEND_URL_INPUT=Frontend URL: "
if "!FRONTEND_URL_INPUT!"=="" (
    echo [ERROR] A frontend URL is required for %ENV_LABEL%.
    goto askFrontendUrl
)
set "FRONTEND_URL=!FRONTEND_URL_INPUT!"
echo [OK] Frontend URL: !FRONTEND_URL!
echo.

echo ------------------------------------------------
echo   Which origins can call this backend?
echo ------------------------------------------------
echo.
echo   Usually just the frontend URL above. Separate multiple
echo   with commas if you have more than one ^(e.g. a marketing
echo   site and the app itself^). Press ENTER to just use the
echo   frontend URL above.
echo.
set "CORS_INPUT="
set /p "CORS_INPUT=Allowed origins (or press ENTER to reuse the frontend URL): "
if "!CORS_INPUT!"=="" (
    set "CORS_ORIGINS=!FRONTEND_URL!"
) else (
    set "CORS_ORIGINS=!CORS_INPUT!"
)
echo [OK] Allowed origins: !CORS_ORIGINS!
echo.

echo ------------------------------------------------
echo   JWT signing secret
echo ------------------------------------------------
echo.
echo   Used to sign login sessions. Must be at least 64
echo   characters. Press ENTER to auto-generate a secure random
echo   one right now ^(recommended unless you already have one
echo   saved from a previous setup of this same environment -
echo   reuse the SAME secret across restarts of %ENV_LABEL%, or
echo   everyone gets logged out each time it changes^).
echo.
set "JWT_INPUT="
set /p "JWT_INPUT=JWT secret (or press ENTER to generate one): "
if "!JWT_INPUT!"=="" (
    for /f "delims=" %%S in ('powershell -NoProfile -Command "[System.Convert]::ToBase64String((1..64 ^| ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))"') do set "JWT_SECRET=%%S"
    echo.
    echo [OK] Generated a random secret. SAVE THIS SOMEWHERE SAFE -
    echo      it won't be shown again after this window closes:
    echo.
    echo      !JWT_SECRET!
    echo.
) else (
    set "JWT_SECRET=!JWT_INPUT!"
    echo [OK] Using the secret you provided.
)
echo.

:skipExtras

REM ---------------------------------------------------------
REM Step 7: Save settings permanently for THIS machine (future
REM start.bat runs will pick them up automatically) AND make them
REM available to THIS session immediately - setx only affects new
REM terminal windows, not this one.
REM ---------------------------------------------------------
echo ------------------------------------------------
echo   Saving your settings
echo ------------------------------------------------
setx MONGODB_URI "%MONGODB_URI%" >nul
setx MONGO_DB "%MONGO_DB%" >nul
setx SPRING_PROFILES_ACTIVE "%SPRING_PROFILE%" >nul
if "%REQUIRE_EXTRAS%"=="1" (
    setx FRONTEND_URL "%FRONTEND_URL%" >nul
    setx CORS_ORIGINS "%CORS_ORIGINS%" >nul
    setx JWT_SECRET "%JWT_SECRET%" >nul
)
echo [OK] Saved. start.bat will use these automatically on this
echo      machine from now on.
echo.

REM ---------------------------------------------------------
REM Step 8: Locate the backend project (same technique as
REM         start.bat - searches for gradlew.bat)
REM ---------------------------------------------------------
echo Looking for the backend project ^(gradlew.bat^)...
set "BACKEND_DIR="
for /f "delims=" %%F in ('dir /s /b "%ROOT%\gradlew.bat" 2^>nul') do (
    if not defined BACKEND_DIR (
        set "FULLPATH=%%F"
        set "BACKEND_DIR=!FULLPATH:\gradlew.bat=!"
    )
)

if not defined BACKEND_DIR (
    echo [ERROR] Could not find gradlew.bat anywhere under:
    echo         %ROOT%
    echo         Make sure the extracted backend project is somewhere
    echo         inside this folder, then run setup-mongodb.bat again.
    echo.
    pause
    exit /b 1
)
echo [OK] Backend project found at: %BACKEND_DIR%
echo.

REM ---------------------------------------------------------
REM Step 9: Bootstrap the backend build tool (first run only)
REM ---------------------------------------------------------
echo ================================================
echo   Preparing backend ^(first run may take a while^)
echo ================================================
pushd "%BACKEND_DIR%"
call gradlew.bat --version
if errorlevel 1 (
    echo.
    echo [ERROR] Gradle wrapper failed to bootstrap. Check your internet
    echo         connection and try again.
    popd
    pause
    exit /b 1
)
popd
echo [OK] Backend build tool ready.
echo.

REM ---------------------------------------------------------
REM Step 10: Start the backend so it connects to MongoDB and
REM          creates every collection/index the app needs.
REM          Runs in its own window so you can watch it happen.
REM ---------------------------------------------------------
echo ================================================
echo   Connecting to MongoDB and setting up the database...
echo ================================================
echo   A new window will open showing the backend starting up.
echo   Watch for a line like:
echo     "DATABASE READY - NN indexes verified across NN collections"
echo   That confirms everything is set up correctly.
echo ================================================
echo.
start "Prowosma DB Setup - Backend" cmd /k "cd /d "%BACKEND_DIR%" && set MONGODB_URI=%MONGODB_URI% && set MONGO_DB=%MONGO_DB% && set SPRING_PROFILES_ACTIVE=%SPRING_PROFILE% && set FRONTEND_URL=%FRONTEND_URL% && set CORS_ORIGINS=%CORS_ORIGINS% && set JWT_SECRET=%JWT_SECRET% && gradlew.bat bootRun"

REM ---------------------------------------------------------
REM Step 11: Poll /actuator/health until Mongo reports UP (or
REM          time out) - this is what actually PROVES the
REM          connection works, not just "the process started".
REM ---------------------------------------------------------
echo Waiting for the backend to connect to MongoDB...
set READY=0
set /a WAITCOUNT=0

:waitloop
set /a WAITCOUNT+=1
powershell -NoProfile -Command ^
  "try { $r = Invoke-RestMethod -Uri 'http://localhost:9090/actuator/health' -TimeoutSec 3; if ($r.status -eq 'UP') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    set READY=1
    goto waitdone
)
if !WAITCOUNT! GEQ 60 goto waitdone
timeout /t 2 /nobreak >nul
goto waitloop

:waitdone
echo.
if "!READY!"=="1" (
    echo ================================================
    echo   SUCCESS - %ENV_LABEL% is set up and ready.
    echo ================================================
    echo   MongoDB connection: verified
    echo   Database name:      %MONGO_DB%
    echo   Collections/indexes: created automatically
    echo   ^(scroll up in the "Prowosma DB Setup - Backend" window
    echo    to see the exact count that was verified^)
    echo ================================================
    echo.
) else (
    echo ================================================
    echo   Could not confirm the database connection within
    echo   2 minutes.
    echo ================================================
    echo   Check the "Prowosma DB Setup - Backend" window for the
    echo   actual error. Common causes:
    echo     - Connection string was copied incorrectly
    echo     - MongoDB Atlas: your IP isn't in Network Access
    echo       ^(Atlas -^> Network Access -^> Add IP Address^)
    echo     - MongoDB Atlas: wrong username/password in the string
    echo     - MongoDB Atlas: the cluster is paused
    echo     - Local MongoDB isn't actually running
    echo     - Staging/Production: a required setting ^(frontend URL,
    echo       CORS origins, JWT secret^) failed to resolve - the
    echo       window will show exactly which one
    echo.
    echo   Fix the issue, close the backend window, and run
    echo   setup-mongodb.bat again.
    echo ================================================
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------------
REM Step 12: Stop the temporary backend cleanly, then either
REM          hand off to start.bat (Development/Staging, where
REM          running via `gradlew bootRun` / `npm run dev` is
REM          the normal way to run it) or stop here (Production,
REM          which should be running from a real build/deploy
REM          pipeline - not a dev-mode script - so this script's
REM          job ends at "the database is confirmed ready").
REM ---------------------------------------------------------
echo Stopping the temporary backend...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":9090 "') do (
    taskkill /F /PID %%P >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq Prowosma DB Setup - Backend*" >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Stopped.
echo.

if "%ENV_CHOICE%"=="3" (
    echo ================================================
    echo   Database setup for Production is complete.
    echo ================================================
    echo   start.bat runs the app in dev mode ^(gradlew bootRun /
    echo   npm run dev^), which isn't how you'd run a real
    echo   production deployment long-term. From here, use your
    echo   normal production build/deploy process - e.g.:
    echo     Backend:  gradlew.bat bootJar  -^> run the built jar
    echo     Frontend: npm run build        -^> host the output
    echo               ^(dist/^) behind a real web server / CDN
    echo   Both will pick up the environment variables this script
    echo   just saved automatically.
    echo ================================================
    echo.
    pause
) else if exist "%ROOT%\start.bat" (
    echo ================================================
    echo   Starting the full app ^(backend + frontend^)...
    echo ================================================
    echo.
    call "%ROOT%\start.bat"
) else (
    echo ================================================
    echo   Setup complete! start.bat wasn't found next to this
    echo   script, so start the app manually:
    echo     cd "%BACKEND_DIR%" ^&^& gradlew.bat bootRun
    echo ================================================
    echo.
    pause
)
