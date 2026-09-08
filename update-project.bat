@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Prowosma Frontend + Backend Updater

echo.
echo ============================================================
echo          PROWOSMA FRONTEND + BACKEND UPDATER
echo ============================================================
echo.

REM ============================================================
REM DESTINATION PATHS
REM ============================================================
REM NOTE: these were previously D:\Projectly\... — left UNCHANGED
REM here because this is your real machine's folder layout, not
REM something safe to guess-rename. If you've renamed (or plan to
REM rename) these folders locally to match the new "Prowosma" name,
REM update the two lines below to match. If you haven't renamed
REM them, leave these exactly as they are — they still point at
REM your real, working checkout.
REM ============================================================

set "FRONTEND_DEST=D:\Projectly\ProjectlyFrontend\projectly-frontend"
set "BACKEND_DEST=D:\Projectly\ProjectlyBackend\projectly-backend"

REM ============================================================
REM OTHER PATHS
REM ============================================================

set "DOWNLOADS=%USERPROFILE%\Downloads"
set "TEMP_DIR=%TEMP%\ProwosmaUpdater"

REM ============================================================
REM DISPLAY CONFIGURATION
REM ============================================================

echo Frontend destination:
echo %FRONTEND_DEST%
echo.

echo Backend destination:
echo %BACKEND_DEST%
echo.

echo Downloads:
echo %DOWNLOADS%
echo.

REM ============================================================
REM VALIDATE DESTINATION FOLDERS
REM ============================================================

if not exist "%FRONTEND_DEST%\" (
    echo ERROR: Frontend destination does not exist:
    echo %FRONTEND_DEST%
    echo.
    pause
    exit /b 1
)

if not exist "%BACKEND_DEST%\" (
    echo ERROR: Backend destination does not exist:
    echo %BACKEND_DEST%
    echo.
    pause
    exit /b 1
)

REM ============================================================
REM FIND FRONTEND ZIP
REM ============================================================

set "FRONTEND_ZIP="

for /f "delims=" %%F in ('dir /b /a-d "%DOWNLOADS%\*frontend*.zip" 2^>nul') do (
    if not defined FRONTEND_ZIP (
        set "FRONTEND_ZIP=%DOWNLOADS%\%%F"
    )
)

REM ============================================================
REM FIND BACKEND ZIP
REM ============================================================

set "BACKEND_ZIP="

for /f "delims=" %%F in ('dir /b /a-d "%DOWNLOADS%\*backend*.zip" 2^>nul') do (
    if not defined BACKEND_ZIP (
        set "BACKEND_ZIP=%DOWNLOADS%\%%F"
    )
)

REM ============================================================
REM VALIDATE ZIP FILES
REM ============================================================

if not defined FRONTEND_ZIP (
    echo.
    echo ============================================================
    echo ERROR: FRONTEND ZIP NOT FOUND
    echo ============================================================
    echo.
    echo Looking for:
    echo %DOWNLOADS%\*frontend*.zip
    echo.
    pause
    exit /b 1
)

if not defined BACKEND_ZIP (
    echo.
    echo ============================================================
    echo ERROR: BACKEND ZIP NOT FOUND
    echo ============================================================
    echo.
    echo Looking for:
    echo %DOWNLOADS%\*backend*.zip
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo ZIP FILES FOUND
echo ============================================================
echo.

echo Frontend ZIP:
echo %FRONTEND_ZIP%
echo.

echo Backend ZIP:
echo %BACKEND_ZIP%
echo.

REM ============================================================
REM CLEAN TEMP DIRECTORY
REM ============================================================

if exist "%TEMP_DIR%" (
    rmdir /S /Q "%TEMP_DIR%"
)

mkdir "%TEMP_DIR%"
mkdir "%TEMP_DIR%\frontend"
mkdir "%TEMP_DIR%\backend"

REM ============================================================
REM EXTRACT FRONTEND
REM ============================================================

echo.
echo ============================================================
echo EXTRACTING FRONTEND
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%FRONTEND_ZIP%' -DestinationPath '%TEMP_DIR%\frontend' -Force"

if errorlevel 1 (
    echo.
    echo ERROR: Frontend ZIP extraction failed.
    echo.
    echo ZIP files have NOT been deleted.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

echo Frontend extracted successfully.

REM ============================================================
REM EXTRACT BACKEND
REM ============================================================

echo.
echo ============================================================
echo EXTRACTING BACKEND
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%BACKEND_ZIP%' -DestinationPath '%TEMP_DIR%\backend' -Force"

if errorlevel 1 (
    echo.
    echo ERROR: Backend ZIP extraction failed.
    echo.
    echo ZIP files have NOT been deleted.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

echo Backend extracted successfully.

REM ============================================================
REM DETECT FRONTEND WRAPPER FOLDER
REM ============================================================

set "FRONTEND_SOURCE=%TEMP_DIR%\frontend"

set "FOLDER_COUNT=0"
set "FILE_COUNT=0"
set "WRAPPER_FOLDER="

for /f "delims=" %%D in ('dir /b /ad "%TEMP_DIR%\frontend" 2^>nul') do (
    set /a FOLDER_COUNT+=1
    set "WRAPPER_FOLDER=%%D"
)

for /f "delims=" %%F in ('dir /b /a-d "%TEMP_DIR%\frontend" 2^>nul') do (
    set /a FILE_COUNT+=1
)

if !FOLDER_COUNT! EQU 1 if !FILE_COUNT! EQU 0 (
    set "FRONTEND_SOURCE=%TEMP_DIR%\frontend\%WRAPPER_FOLDER%"
)

REM ============================================================
REM DETECT BACKEND WRAPPER FOLDER
REM ============================================================

set "BACKEND_SOURCE=%TEMP_DIR%\backend"

set "FOLDER_COUNT=0"
set "FILE_COUNT=0"
set "WRAPPER_FOLDER="

for /f "delims=" %%D in ('dir /b /ad "%TEMP_DIR%\backend" 2^>nul') do (
    set /a FOLDER_COUNT+=1
    set "WRAPPER_FOLDER=%%D"
)

for /f "delims=" %%F in ('dir /b /a-d "%TEMP_DIR%\backend" 2^>nul') do (
    set /a FILE_COUNT+=1
)

if !FOLDER_COUNT! EQU 1 if !FILE_COUNT! EQU 0 (
    set "BACKEND_SOURCE=%TEMP_DIR%\backend\%WRAPPER_FOLDER%"
)

REM ============================================================
REM DISPLAY SOURCE AND DESTINATION
REM ============================================================

echo.
echo ============================================================
echo SOURCE AND DESTINATION
echo ============================================================
echo.

echo FRONTEND SOURCE:
echo %FRONTEND_SOURCE%
echo.

echo FRONTEND DESTINATION:
echo %FRONTEND_DEST%
echo.

echo BACKEND SOURCE:
echo %BACKEND_SOURCE%
echo.

echo BACKEND DESTINATION:
echo %BACKEND_DEST%
echo.

REM ============================================================
REM VERIFY SOURCE FOLDERS
REM ============================================================

if not exist "%FRONTEND_SOURCE%\" (
    echo ERROR: Frontend source folder does not exist.
    echo.
    echo ZIP files have NOT been deleted.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

if not exist "%BACKEND_SOURCE%\" (
    echo ERROR: Backend source folder does not exist.
    echo.
    echo ZIP files have NOT been deleted.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

REM ============================================================
REM SAFETY CONFIRMATION
REM ============================================================

echo.
echo ============================================================
echo                    IMPORTANT
echo ============================================================
echo.
echo 1. EVERY file from the ZIP will be copied.
echo 2. Existing matching files WILL be overwritten.
echo 3. Destination-only files WILL NOT be deleted.
echo 4. Destination-only folders WILL NOT be deleted.
echo 5. ZIP files will be deleted ONLY after both copies succeed.
echo.
echo ============================================================
echo.

choice /C YN /M "Continue"

if errorlevel 2 (
    echo.
    echo Update cancelled.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 0
)

REM ============================================================
REM COPY FRONTEND
REM ============================================================

echo.
echo ============================================================
echo                  COPYING FRONTEND
echo ============================================================
echo.

xcopy "%FRONTEND_SOURCE%\*" "%FRONTEND_DEST%\" /E /I /H /K /Y

if errorlevel 1 (
    echo.
    echo ============================================================
    echo ERROR: FRONTEND COPY FAILED
    echo ============================================================
    echo.
    echo ZIP files have NOT been deleted.
    echo.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

echo.
echo ============================================================
echo FRONTEND COPY COMPLETED SUCCESSFULLY
echo ============================================================
echo.

REM ============================================================
REM COPY BACKEND
REM ============================================================

echo.
echo ============================================================
echo                  COPYING BACKEND
echo ============================================================
echo.

xcopy "%BACKEND_SOURCE%\*" "%BACKEND_DEST%\" /E /I /H /K /Y

if errorlevel 1 (
    echo.
    echo ============================================================
    echo ERROR: BACKEND COPY FAILED
    echo ============================================================
    echo.
    echo Frontend was already updated.
    echo.
    echo ZIP files have NOT been deleted.
    echo.
    rmdir /S /Q "%TEMP_DIR%"
    pause
    exit /b 1
)

echo.
echo ============================================================
echo BACKEND COPY COMPLETED SUCCESSFULLY
echo ============================================================
echo.

REM ============================================================
REM DELETE ZIP FILES
REM ============================================================

echo.
echo ============================================================
echo                  DELETING ZIP FILES
echo ============================================================
echo.

del /F /Q "%FRONTEND_ZIP%"

if exist "%FRONTEND_ZIP%" (
    echo WARNING: Frontend ZIP could not be deleted.
) else (
    echo Frontend ZIP deleted successfully.
)

del /F /Q "%BACKEND_ZIP%"

if exist "%BACKEND_ZIP%" (
    echo WARNING: Backend ZIP could not be deleted.
) else (
    echo Backend ZIP deleted successfully.
)

REM ============================================================
REM DELETE TEMP DIRECTORY
REM ============================================================

echo.
echo Cleaning temporary extraction directory...

rmdir /S /Q "%TEMP_DIR%"

REM ============================================================
REM COMPLETE
REM ============================================================

echo.
echo.
echo ============================================================
echo              UPDATE COMPLETED SUCCESSFULLY
echo ============================================================
echo.
echo Frontend:
echo   ALL files copied
echo.
echo Backend:
echo   ALL files copied
echo.
echo Existing destination files:
echo   PRESERVED
echo.
echo Matching files:
echo   OVERWRITTEN
echo.
echo New files:
echo   COPIED
echo.
echo Destination-only files:
echo   PRESERVED
echo.
echo ZIP files:
echo   DELETED
echo.
echo ============================================================
echo.

pause
endlocal