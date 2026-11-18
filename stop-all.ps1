<#
  Prowosma - stop everything start-all.ps1 started.
  Stops whatever listens on the app's ports (9090 backend, 5173 frontend, 8765 speech-to-text), and MongoDB only if
  start-all started it (a MongoDB Windows service or one you started yourself is left running). Ollama is left running.
#>
$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$Run  = Join-Path $Root ".prowosma-run"

function Stop-Port([int]$port, [string]$label) {
    $pids = @()
    try { $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique } catch { }
    if (-not $pids -or $pids.Count -eq 0) { Write-Host "  $label (port $port) wasn't running."; return }
    foreach ($procId in $pids) {
        # Stop the whole process tree (gradle -> java, npm -> node) so nothing is left holding the port.
        & taskkill /PID $procId /T /F | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "  Stopped $label (PID $procId)." -ForegroundColor Green }
        else { Write-Host "  Couldn't stop $label (PID $procId) - close its window." -ForegroundColor Yellow }
    }
}

Write-Host ""
Write-Host "  Stopping Prowosma" -ForegroundColor White
Stop-Port 5173 "Frontend"
$fePortFile = Join-Path $Run "frontend-port"
if (Test-Path $fePortFile) {
    $fp = [int](Get-Content $fePortFile)
    if ($fp -ne 5173) { Stop-Port $fp "Frontend" }
    Remove-Item $fePortFile -ErrorAction SilentlyContinue
}
Stop-Port 9090 "Backend"
Stop-Port 8765 "Speech-to-text"

$mongoPid = Join-Path $Run "mongod.pid"
if (Test-Path $mongoPid) {
    $procId = Get-Content $mongoPid
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { Stop-Process -Id $procId; Write-Host "  Stopped MongoDB (started by start-all)." -ForegroundColor Green }
    Remove-Item $mongoPid
}
$mongoDocker = Join-Path $Run "mongo-docker"
if (Test-Path $mongoDocker) {
    & docker stop (Get-Content $mongoDocker) | Out-Null
    Write-Host "  Stopped the MongoDB Docker container (your data stays in the 'prowosma-mongo' volume)." -ForegroundColor Green
    Remove-Item $mongoDocker
}

# Close the windows start-all opened (they stay open after their program stops).
foreach ($f in Get-ChildItem $Run -Filter "Prowosma*.pid" -ErrorAction SilentlyContinue) {
    $procId = Get-Content $f.FullName
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { & taskkill /PID $procId /T /F | Out-Null }
    Remove-Item $f.FullName
}
Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host ""
