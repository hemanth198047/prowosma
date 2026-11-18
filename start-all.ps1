<#
  Prowosma - start EVERYTHING on a Windows computer (PowerShell 5.1 or 7).

  Starts, in this order, each in its own window, skipping anything already running:
    1. MongoDB            (local service / installed mongod / Docker; skipped when backend\.env points to a cloud database)
    2. Speech-to-text     (tools\stt-server, for the AI Meeting Assistant's recordings; port 8765)
    3. Local AI model     (only with -LocalAI: Ollama + qwen2.5:7b; otherwise the AI Settings provider is used)
    4. Backend            (Spring Boot, port 9090)
    5. Frontend           (Vite, port 5173) - then prints the address to open (add -OpenBrowser to open it automatically)

  First run installs what is missing (asks before using winget), creates backend\.env from .env.example, and adds
  JWT_SECRET / ENCRYPTION_KEY to it if they are empty. Existing values in backend\.env are never changed.

  Usage (from the project folder):   .\start-all.bat            (double-click works too)
                                      .\start-all.bat -LocalAI   (also run a free local AI model with Ollama)
                                      .\start-all.bat -NoSpeech  (skip speech-to-text; transcripts and Fireflies still work)
  Stop everything:                    .\stop-all.bat
#>
param(
    [switch]$LocalAI,
    [switch]$NoSpeech,
    [switch]$OpenBrowser,              # also open the app in the browser at the end (off by default: no surprise extra window)
    [switch]$Yes,                      # answer "yes" to install questions
    [string]$SpeechModel = "small"     # tiny | base | small | medium | large-v3
)

# "Continue", not "Stop": in Windows PowerShell 5.1, "Stop" turns any warning a program prints (py, pip, npm, git) into a crash.
# Every step below checks its own result instead.
$ErrorActionPreference = "Continue"
$Root     = $PSScriptRoot
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Stt      = Join-Path $Root "tools\stt-server"
$Run      = Join-Path $Root ".prowosma-run"
$EnvFile  = Join-Path $Backend ".env"
New-Item -ItemType Directory -Force -Path $Run, (Join-Path $Run "logs") | Out-Null
$Host.UI.RawUI.WindowTitle = "Prowosma launcher"

# -- helpers -----------------------------------------------------------------------------------------

function Say([string]$text, [string]$color = "Gray") { Write-Host $text -ForegroundColor $color }
function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Ok([string]$text)   { Write-Host "   [OK] $text" -ForegroundColor Green }
function Warn([string]$text) { Write-Host "   [!]  $text" -ForegroundColor Yellow }
function Fail([string]$text) { Write-Host "   [X]  $text" -ForegroundColor Red; Write-Host ""; Read-Host "Press Enter to close"; exit 1 }

function Has([string]$cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Ask([string]$question) {
    if ($Yes) { return $true }
    $a = Read-Host "   $question [Y/n]"
    return ($a -eq "" -or $a -match "^[Yy]")
}

function Install-WithWinget([string]$id, [string]$what) {
    if (-not (Has "winget")) { return $false }
    if (-not (Ask "Install $what now with winget?")) { return $false }
    winget install --id $id -e --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
    return $true
}

function Port-Open([int]$port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $c.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(500)) { return $false }
        $c.EndConnect($iar); return $true
    } catch { return $false } finally { $c.Close() }
}

function Wait-Port([int]$port, [int]$seconds, [string]$what) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Port-Open $port) { return $true }
        Start-Sleep -Seconds 2
        Write-Host "." -NoNewline
    }
    Write-Host ""
    return $false
}

function Wait-Http([string]$url, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Write-Host ""; return $true }
        } catch { }
        Start-Sleep -Seconds 3
        Write-Host "." -NoNewline
    }
    Write-Host ""
    return $false
}

function Random-Base64([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return [Convert]::ToBase64String($b)
}

# backend\.env: read values, and add a key only when it is missing or empty (never overwrite).
function Read-EnvFile {
    $map = @{}
    if (Test-Path $EnvFile) {
        foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    return $map
}

function Ensure-EnvValue([string]$key, [string]$value, [string]$why) {
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path $EnvFile) { $lines.AddRange([string[]][IO.File]::ReadAllLines($EnvFile)) }
    $idx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*$key\s*=") { $idx = $i; break } }
    if ($idx -ge 0) {
        $current = ($lines[$idx] -replace "^\s*$key\s*=", "").Trim()
        if ($current -ne "") { return $false }
        $lines[$idx] = "$key=$value"
    } else {
        $lines.Add("# $why (added by start-all)")
        $lines.Add("$key=$value")
    }
    [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.UTF8Encoding $false))   # no BOM: Spring reads the first key correctly
    return $true
}

function Start-Window([string]$title, [string]$workdir, [string]$command, [hashtable]$vars) {
    $set = ""
    if ($vars) {
        foreach ($k in $vars.Keys) {
            $v = ([string]$vars[$k]).Replace("'", "''")          # quote for a single-quoted PowerShell string
            $set += "`$env:$k='$v'; "
        }
    }
    $script = "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location -LiteralPath '$workdir'; $set $command"
    $exe = if (Has "pwsh") { "pwsh" } else { "powershell" }
    $p = Start-Process -FilePath $exe -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script) -PassThru
    Set-Content -Path (Join-Path $Run "$($title -replace '[^A-Za-z0-9]', '').pid") -Value $p.Id
    return $p
}

# -- 1. prerequisites --------------------------------------------------------------------------------

Say ""
Say "  Prowosma - starting everything" "White"
Say "  Project: $Root" "DarkGray"

Step "Checking what's installed"
if (-not (Test-Path (Join-Path $Backend "gradlew.bat"))) { Fail "backend\gradlew.bat not found. Run this from the project folder (next to the backend and frontend folders)." }
if (-not (Test-Path (Join-Path $Frontend "package.json"))) { Fail "frontend\package.json not found." }

if (-not (Has "java")) {
    if (-not (Install-WithWinget "EclipseAdoptium.Temurin.21.JDK" "Java 21")) { Fail "Java 21 is needed: https://adoptium.net/temurin/releases/?version=21" }
}
$javaVersion = (& cmd /c "java -version 2>&1") -join " "
if ($javaVersion -match 'version "(\d+)') { if ([int]$Matches[1] -lt 21) { Fail "Java 21 or newer is needed (found $($Matches[1])). Install it from https://adoptium.net" } }
Ok "Java"

if (-not (Has "node")) {
    if (-not (Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS")) { Fail "Node.js is needed: https://nodejs.org" }
}
Ok "Node.js $(node --version)"

if (-not (Has "ffmpeg")) {
    if (Install-WithWinget "Gyan.FFmpeg" "ffmpeg (splits long recordings)") { if (Has "ffmpeg") { Ok "ffmpeg" } else { Warn "ffmpeg installed - open a new window for it to be found next time." } }
    else { Warn "ffmpeg not installed - long recordings can't be split (short ones still work). winget install Gyan.FFmpeg" }
} else { Ok "ffmpeg" }

$python = $null
if (-not $NoSpeech) {
    foreach ($v in @("3.12", "3.11", "3.10")) {
        if (Has "py") {
            $out = & cmd /c "py -$v -c ""print(1)"" 2>nul"
            if ($out -eq "1") { $python = @("py", "-$v"); break }
        }
    }
    if (-not $python -and (Has "python")) {
        $pv = & cmd /c "python -c ""import sys; print('%d.%d' % sys.version_info[:2])"" 2>nul"
        if ($pv -match '^3\.(10|11|12)$') { $python = @("python") }
    }
    if (-not $python) {
        if (Install-WithWinget "Python.Python.3.12" "Python 3.12 (for speech-to-text)") { Refresh-Path; if (Has "py") { $python = @("py", "-3.12") } }
    }
    if ($python) { Ok "Python ($($python -join ' '))" }
    else { Warn "Python 3.10-3.12 not found - starting without speech-to-text (recordings can't be transcribed). Re-run after installing Python 3.12."; $NoSpeech = $true }
}

# -- 2. settings (backend\.env) ----------------------------------------------------------------------

Step "Settings (backend\.env)"
if (-not (Test-Path $EnvFile)) {
    $example = Join-Path $Backend ".env.example"
    if (Test-Path $example) { Copy-Item $example $EnvFile; Ok "Created backend\.env from .env.example" }
    else { New-Item -ItemType File -Path $EnvFile | Out-Null; Ok "Created an empty backend\.env" }
}
if (Ensure-EnvValue "JWT_SECRET" (Random-Base64 64) "Signs sign-in sessions") { Ok "Generated JWT_SECRET" }
if (Ensure-EnvValue "ENCRYPTION_KEY" (Random-Base64 32) "Encrypts saved keys and sign-ins - never change it once data exists") { Ok "Generated ENCRYPTION_KEY" }
if (-not $NoSpeech) {
    if (Ensure-EnvValue "UMA_STT_BASE_URL" "http://127.0.0.1:8765" "AI Meeting Assistant speech-to-text (tools\stt-server)") { Ok "Speech-to-text address added" }
    [void](Ensure-EnvValue "UMA_STT_MODEL" $SpeechModel "Speech-to-text model")
}
$envValues = Read-EnvFile
Ok "Settings ready (existing values left as they were)"

# -- 3. MongoDB --------------------------------------------------------------------------------------

Step "MongoDB"
$mongoUri = if ($envValues["MONGODB_URI"]) { $envValues["MONGODB_URI"] } elseif ($env:MONGODB_URI) { $env:MONGODB_URI } else { "mongodb://localhost:27017" }
$localMongo = $mongoUri -match '^mongodb://(localhost|127\.0\.0\.1)(:27017)?(/|$|\?)'
if (-not $localMongo) {
    Ok "Using the database in backend\.env (not local) - nothing to start"
} elseif (Port-Open 27017) {
    Ok "Already running on port 27017"
} else {
    $started = $false
    $svc = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
    if ($svc) {
        try { Start-Service -Name "MongoDB"; $started = $true; Ok "Started the MongoDB Windows service" }
        catch { Warn "The MongoDB service needs administrator rights to start. Trying another way..." }
    }
    if (-not $started) {
        $mongod = (Get-Command "mongod" -ErrorAction SilentlyContinue).Source
        if (-not $mongod) { $mongod = Get-ChildItem "C:\Program Files\MongoDB\Server\*\bin\mongod.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName }
        if ($mongod) {
            $data = Join-Path $Run "mongo-data"; New-Item -ItemType Directory -Force -Path $data | Out-Null
            $p = Start-Process -FilePath $mongod -ArgumentList @("--dbpath", "`"$data`"", "--port", "27017", "--bind_ip", "127.0.0.1") -WindowStyle Minimized -PassThru
            Set-Content -Path (Join-Path $Run "mongod.pid") -Value $p.Id
            $started = $true; Ok "Started mongod (data in .prowosma-run\mongo-data)"
        } elseif (Has "docker") {
            & docker info *> $null
            if ($LASTEXITCODE -ne 0) { Fail "MongoDB isn't running, and Docker is installed but not running. Start Docker Desktop (or install MongoDB Community Server), then run this again." }
            $exists = (& docker ps -a --filter "name=^prowosma-mongo$" --format "{{.Names}}") -eq "prowosma-mongo"
            if ($exists) { & docker start prowosma-mongo | Out-Null } else { & docker run -d --name prowosma-mongo -p 27017:27017 -v prowosma-mongo:/data/db mongo:7 | Out-Null }
            Set-Content -Path (Join-Path $Run "mongo-docker") -Value "prowosma-mongo"
            $started = $true; Ok "Started MongoDB in Docker (container prowosma-mongo)"
        } elseif (Install-WithWinget "MongoDB.Server" "MongoDB Community Server") {
            try { Start-Service -Name "MongoDB"; $started = $true; Ok "Installed and started MongoDB" } catch { Warn "Installed. Start the 'MongoDB' service (or reboot), then run this again." }
        }
    }
    if (-not $started) { Fail "MongoDB isn't running and couldn't be started. Install MongoDB Community Server, or put a cloud connection string in backend\.env (MONGODB_URI), or run setup-mongodb.bat." }
    Write-Host "   waiting for MongoDB" -NoNewline
    if (-not (Wait-Port 27017 60 "MongoDB")) { Fail "MongoDB didn't start listening on port 27017." }
    Ok "MongoDB is ready"
}

# -- 4. speech-to-text -------------------------------------------------------------------------------

if (-not $NoSpeech) {
    Step "Speech-to-text (AI Meeting Assistant recordings)"
    if (Port-Open 8765) {
        Ok "Already running on port 8765"
    } else {
        $venv = Join-Path $Stt ".venv"
        $venvPy = Join-Path $venv "Scripts\python.exe"
        if (-not (Test-Path $venvPy)) {
            Say "   Creating a Python environment (first run only)..."
            $pyArgs = @()
            if ($python.Count -gt 1) { $pyArgs = $python[1..($python.Count - 1)] }
            & $python[0] @pyArgs -m venv $venv
            if (-not (Test-Path $venvPy)) { Fail "Couldn't create the Python environment in tools\stt-server\.venv" }
        }
        $req = Join-Path $Stt "requirements.txt"
        $hash = (Get-FileHash $req -Algorithm SHA256).Hash
        $stamp = Join-Path $venv ".requirements.sha256"
        if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne $hash) {
            Say "   Installing speech-to-text packages (first run takes a few minutes)..."
            & $venvPy -m pip install --upgrade pip -q
            & $venvPy -m pip install -r $req -q
            if ($LASTEXITCODE -ne 0) { Fail "Installing the speech-to-text packages failed (see above)." }
            Set-Content -Path $stamp -Value $hash
        }
        $null = Start-Window "Prowosma Speech-to-text" $Stt "& '$venvPy' -m uvicorn server:app --host 127.0.0.1 --port 8765" @{
            STT_MODEL = $SpeechModel; HF_HUB_DISABLE_XET = "1" }
        Write-Host "   waiting for speech-to-text" -NoNewline
        if (Wait-Http "http://127.0.0.1:8765/health" 120) { Ok "Running (the $SpeechModel model downloads on first use, ~500 MB)" }
        else { Warn "Speech-to-text didn't answer yet - check its window. The rest keeps starting." }
    }
}

# -- 5. local AI model (optional) --------------------------------------------------------------------

$backendVars = @{}
if ($LocalAI) {
    Step "Local AI model (Ollama)"
    if (-not (Has "ollama")) {
        if (-not (Install-WithWinget "Ollama.Ollama" "Ollama")) { Warn "Ollama not installed - using the provider in AI Settings instead." }
    }
    if (Has "ollama") {
        if (-not (Port-Open 11434)) { Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized | Out-Null; [void](Wait-Port 11434 30 "Ollama") }
        $models = (& ollama list) -join "`n"
        if ($models -notmatch "qwen2\.5:7b") { Say "   Downloading qwen2.5:7b (~4.7 GB, first run only)..."; & ollama pull qwen2.5:7b }
        $backendVars["UMA_LLM_BASE_URL"] = "http://127.0.0.1:11434/v1"
        $backendVars["UMA_LLM_MODEL"]    = "qwen2.5:7b"
        $backendVars["UMA_LLM_PREFER"]   = "self-hosted"
        Ok "Ollama with qwen2.5:7b (needs ~6 GB free memory)"
    }
}

# -- 6. backend --------------------------------------------------------------------------------------

Step "Backend (port 9090)"
if (Port-Open 9090) {
    Ok "Already running"
} else {
    $null = Start-Window "Prowosma Backend" $Backend ".\gradlew.bat bootRun" $backendVars
    Write-Host "   waiting for the backend (first run downloads dependencies, can take several minutes)" -NoNewline
    if (Wait-Http "http://localhost:9090/actuator/health/liveness" 600) { Ok "Backend is up" }
    else { Warn "The backend didn't answer within 10 minutes - check the 'Prowosma Backend' window. Continuing." }
}

# -- 7. frontend -------------------------------------------------------------------------------------

Step "Frontend (port 5173)"
if (Port-Open 5173) {
    Ok "Already running"
} else {
    $lock = Join-Path $Frontend "package-lock.json"
    $installed = Join-Path $Frontend "node_modules\.package-lock.json"
    if (-not (Test-Path $installed) -or ((Test-Path $lock) -and (Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)) {
        Say "   Installing frontend packages..."
        Push-Location $Frontend
        & npm install --no-audit --no-fund --legacy-peer-deps
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Fail "npm install failed (see above)." }
    }
    $null = Start-Window "Prowosma Frontend" $Frontend "npm run dev" @{}
    Write-Host "   waiting for the frontend" -NoNewline
    if (Wait-Port 5173 120 "frontend") { Ok "Frontend is up" } else { Warn "The frontend didn't start - check the 'Prowosma Frontend' window." }
}

# -- done --------------------------------------------------------------------------------------------

Say ""
Say "  Prowosma is running" "Green"
Say "    App:             http://localhost:5173   <- open this in your browser" "White"
Say "    Backend:         http://localhost:9090"
if (-not $NoSpeech) { Say "    Speech-to-text:  http://127.0.0.1:8765/health" }
Say ""
Say "  AI Meeting Assistant: an admin turns it on once in Admin Centre -> Feature flags -> 'AI Meeting Assistant (new)'." "DarkGray"
Say "  Fireflies / Google Meet: AI Meeting Assistant -> Connections (setup: backend\docs\universal-meeting-assistant\09-CONNECTIONS-SETUP.md)." "DarkGray"
Say "  Stop everything with stop-all.bat." "DarkGray"
# Only when asked: opening it automatically gave a second window to people who had already opened the app while it started.
if ($OpenBrowser) { Start-Process "http://localhost:5173" }
Say ""
