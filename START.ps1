# RIGHT AGENT GROUP - ONE CLICK STARTUP (all 7 services)
# Run: PowerShell -ExecutionPolicy Bypass -File START.ps1

$ProjectDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
Set-Location $ProjectDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RIGHT AGENT GROUP - Starting Up..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Stop-Port($port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
    } catch {}
}

# 0. PostgreSQL (must already be installed as a Windows service)
Write-Host "[1/6] Checking PostgreSQL..." -ForegroundColor Yellow
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService) {
    if ($pgService.Status -ne "Running") {
        Start-Service $pgService.Name
        Start-Sleep -Seconds 3
    }
    Write-Host "      OK PostgreSQL running ($($pgService.Name))" -ForegroundColor Green
} else {
    Write-Host "      WARN PostgreSQL service not found - make sure it is installed and running!" -ForegroundColor Red
}

# 1. Groq (cloud AI brain — nothing to start locally, just verify the key is set)
Write-Host "[2/6] AI brain: Groq Cloud API..." -ForegroundColor Yellow
$groqLine = (Get-Content "$ProjectDir\.env" -ErrorAction SilentlyContinue) | Select-String "^\s*GROQ_API_KEY=\S" | Select-Object -First 1
if ($groqLine) {
    Write-Host "      OK GROQ_API_KEY set (cloud brain, no local AI process needed)" -ForegroundColor Green
} else {
    Write-Host "      WARN GROQ_API_KEY missing in .env - AI replies WILL FAIL. Get a free key at console.groq.com" -ForegroundColor Red
}

# 2. WhatsApp: official Meta Cloud API - no local service needed anymore.
Write-Host "[3/6] WhatsApp: using official Meta Cloud API (no local service)" -ForegroundColor Green
$waProcess = $null

# Propagate internal auth + STT settings from .env to child processes.
# (The Python STT service does NOT read .env itself — it only sees the
#  environment it inherits from this script.)
$envLines = Get-Content "$ProjectDir\.env" -ErrorAction SilentlyContinue
foreach ($name in @("STT_API_KEY", "STT_MODEL", "STT_FORCE_DEVICE", "WHATSAPP_SERVICE_KEY", "CF_TUNNEL_NAME")) {
    $line = $envLines | Select-String "^\s*$name=" | Select-Object -First 1
    if ($line) {
        $val = $line.ToString().Split("=",2)[1].Split("#",2)[0].Trim()
        if ($val) { Set-Item -Path "Env:$name" -Value $val }
    }
}
# STT_API_KEY defaults to the shared service key if not set separately
if (-not $env:STT_API_KEY -and $env:WHATSAPP_SERVICE_KEY) { $env:STT_API_KEY = $env:WHATSAPP_SERVICE_KEY }
if (-not $env:STT_API_KEY) { Write-Host "      WARN WHATSAPP_SERVICE_KEY / STT_API_KEY missing in .env - STT will reject requests" -ForegroundColor Red }

# Production safety check: unsigned WhatsApp webhook is publicly abusable
$appSecretLine = $envLines | Select-String "^\s*WHATSAPP_APP_SECRET=\s*\S"
if (-not $appSecretLine) { Write-Host "      WARN WHATSAPP_APP_SECRET missing in .env - /api/whatsapp webhook accepts UNSIGNED requests from anyone!" -ForegroundColor Red }

# Logs directory — these 3 services run hidden with nowhere to see their
# output otherwise, which made timing/duration bugs impossible to diagnose
# after the fact. stdout+stderr both land here now.
$logsDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

# 3. Whisper STT Service (port 3003) - needed for voice calls
Write-Host "[4/6] Starting Whisper STT..." -ForegroundColor Yellow
$sttProcess = $null
$sttDir = Join-Path $ProjectDir "server\stt-service"
$venvPython = Join-Path $sttDir "venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    Stop-Port 3003
    $sttProcess = Start-Process $venvPython -ArgumentList "-m","uvicorn","app:app","--host","127.0.0.1","--port","3003" -WorkingDirectory $sttDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir "stt.log") -RedirectStandardError (Join-Path $logsDir "stt.err.log")
    Write-Host "      OK STT starting (PID: $($sttProcess.Id)) - first run downloads the model (~3GB)" -ForegroundColor Green
} else {
    Write-Host "      SKIP STT venv not found - voice calls will not hear the caller!" -ForegroundColor Red
    Write-Host "      Setup: cd server\stt-service; python -m venv venv; venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
}

# 4. TTS Service (port 3004) - Priya's voice for phone calls (Edge TTS, free, no GPU needed)
Write-Host "[5/7] Starting TTS service..." -ForegroundColor Yellow
$ttsProcess = $null
$ttsDir = Join-Path $ProjectDir "server\tts-service"
$ttsVenvPython = Join-Path $ttsDir "venv\Scripts\python.exe"
$ttsPython = if (Test-Path $ttsVenvPython) { $ttsVenvPython } else { "python" }
Stop-Port 3004
$ttsProcess = Start-Process $ttsPython -ArgumentList "-m","uvicorn","app:app","--host","127.0.0.1","--port","3004" -WorkingDirectory $ttsDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir "tts.log") -RedirectStandardError (Join-Path $logsDir "tts.err.log")
Start-Sleep -Seconds 1
Write-Host "      OK TTS started (PID: $($ttsProcess.Id))" -ForegroundColor Green

# 5. Voicebot Server (port 3002) - the phone call brain
Write-Host "[6/7] Starting Voicebot..." -ForegroundColor Yellow
Stop-Port 3002
$vbProcess = Start-Process "node" -ArgumentList "server\voicebot-server.js" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logsDir "voicebot.log") -RedirectStandardError (Join-Path $logsDir "voicebot.err.log")
Start-Sleep -Seconds 1
Write-Host "      OK Voicebot started (PID: $($vbProcess.Id)) - logs: logs\voicebot.log" -ForegroundColor Green

# 6. Website (port 3000)
Write-Host "[7/7] Starting Website..." -ForegroundColor Yellow
Stop-Port 3000
$webProcess = Start-Process "cmd" -ArgumentList "/c npm start" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5
Write-Host "      OK Website started at http://localhost:3000" -ForegroundColor Green

# 6. Public tunnel
# No domain yet -> scripts/tunnel-autofix.ps1 uses ngrok's reserved free
# static domain (NGROK_DOMAIN in .env), which — unlike a Cloudflare QUICK
# tunnel — does NOT change between restarts, so it stays registered in
# Google Console + Meta once it's set up. Swap to a NAMED Cloudflare tunnel
# (set CF_TUNNEL_NAME) once the client hands over a real domain for the demo:
#   cloudflared tunnel create rag && cloudflared tunnel route dns rag your-domain.com
$cfProcess = $null
$namedTunnel = $env:CF_TUNNEL_NAME
if ($namedTunnel) {
    if (Get-Command "cloudflared" -ErrorAction SilentlyContinue) {
        $cfProcess = Start-Process "cloudflared" -ArgumentList "tunnel run $namedTunnel" -WindowStyle Minimized -PassThru
        Write-Host "      OK Named tunnel '$namedTunnel' started (stable URL)" -ForegroundColor Green
    } else {
        Write-Host "      SKIP cloudflared not found - run: winget install Cloudflare.cloudflared" -ForegroundColor Yellow
    }
} elseif (Get-Command "ngrok" -ErrorAction SilentlyContinue) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectDir "scripts\tunnel-autofix.ps1") -ProjectDir $ProjectDir
} else {
    Write-Host "      SKIP ngrok not found - run: winget install ngrok.ngrok (then: ngrok config add-authtoken <token>)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ALL SERVICES STARTED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard : http://localhost:3000" -ForegroundColor White
Write-Host "  WhatsApp  : Meta Cloud API (no QR) - check status in dashboard > WhatsApp Chat" -ForegroundColor White
Write-Host "  Voicebot  : ws://localhost:3002  |  STT: http://localhost:3003" -ForegroundColor White
Write-Host "  Health    : http://localhost:3000/api/test (after login)" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop everything" -ForegroundColor Gray
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 30
        try {
            Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 3 -ErrorAction Stop | Out-Null
        } catch {
            Write-Host "  Website down - restarting..." -ForegroundColor Yellow
            Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
            $webProcess = Start-Process "cmd" -ArgumentList "/c npm start" -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru
            Write-Host "  Website restarted" -ForegroundColor Green
        }
    }
} finally {
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    foreach ($p in @($waProcess, $ttsProcess, $vbProcess, $sttProcess, $webProcess, $cfProcess)) {
        if ($p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "All stopped." -ForegroundColor Green
}
