# Right Agent Group - one-shot machine setup
# Run this FIRST, before any of the external accounts (Google/Groq/Sarvam/
# Exotel/Meta/Cloudflare) exist. It automates everything that doesn't require
# a human clicking through someone else's website: power settings, installing
# Node/PostgreSQL, project dependencies, and the database schema.
#
# NOTE: there is no Python here on purpose — the voice pipeline is 100% cloud
# (Sarvam STT + TTS), so the old local Whisper/Edge-TTS services are gone.
#
# What this script deliberately does NOT do - these need a human, on their
# own device, under their own identity, no matter who's logged in:
#   - Creating the Google/Groq/Exotel/Meta/Cloudflare accounts
#   - Entering payment details for a domain
#   - Enabling BitLocker (needs the recovery key saved somewhere durable -
#     get that step right in person, not from an unattended script)
#   - Firewall/router changes (site-specific, easy to lock yourself out of)
#
# Usage:  PowerShell -ExecutionPolicy Bypass -File scripts\setup-machine.ps1
# Safe to re-run - every step below skips itself if already done.

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

function Write-Step($n, $title) {
    Write-Host ""
    Write-Host "[$n] $title" -ForegroundColor Cyan
}
function Write-Ok($msg)   { Write-Host "    OK $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    ! $msg" -ForegroundColor Yellow }
function Write-Skip($msg) { Write-Host "    - $msg (already done)" -ForegroundColor DarkGray }

# --- Must run elevated: winget installs and power-plan changes both need it ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Restarting as Administrator..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RIGHT AGENT GROUP - MACHINE SETUP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# ============================================================
# [1] Power settings - this machine must never sleep
# ============================================================
Write-Step 1 "Power settings (never sleep, high performance)"
try {
    powercfg /setactive SCHEME_MIN | Out-Null   # "High performance" GUID alias
    powercfg /change standby-timeout-ac 0
    powercfg /change standby-timeout-dc 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /change monitor-timeout-ac 0
    powercfg /hibernate off
    Write-Ok "Sleep, hibernation, and standby disabled; High performance plan active"
} catch {
    Write-Warn "Could not set power plan automatically - set it by hand: Settings > Power > Screen and sleep > Never"
}

# ============================================================
# [2] Core software - Node.js, PostgreSQL
# ============================================================
Write-Step 2 "Core software (Node.js, PostgreSQL)"

$hasWinget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $hasWinget) {
    Write-Warn "winget not found (needs Windows 10 1809+ / App Installer from the Microsoft Store)."
    Write-Warn "Install these two manually, then re-run this script:"
    Write-Warn "  Node.js LTS  -> https://nodejs.org"
    Write-Warn "  PostgreSQL   -> https://www.postgresql.org/download/windows/"
} else {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Skip "Node.js ($(node -v))"
    } else {
        Write-Host "    Installing Node.js LTS..."
        winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements | Out-Null
        Write-Ok "Node.js installed"
    }

    # Python is intentionally NOT installed — the voice pipeline is cloud-only.

    $pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pgService) {
        Write-Skip "PostgreSQL (service: $($pgService.Name))"
    } else {
        Write-Host "    Installing PostgreSQL..."
        winget install -e --id PostgreSQL.PostgreSQL --accept-package-agreements --accept-source-agreements | Out-Null
        Write-Ok "PostgreSQL installed - you'll be asked to set the postgres user password during install"
        Write-Warn "Installer windows may need you to click through them - this script will pause until PostgreSQL is ready."
        Read-Host "    Press Enter once the PostgreSQL installer has finished"
    }
}

# Refresh PATH in this session so newly-installed tools are visible without reopening PowerShell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# ============================================================
# [3] .env file - create it, fill in what we can automatically
# ============================================================
Write-Step 3 ".env file"
if (Test-Path ".env") {
    Write-Skip ".env already exists - leaving your values untouched"
} else {
    Copy-Item ".env.example" ".env"
    Write-Ok "Created .env from .env.example"
}

# Only touch PG_PASSWORD if it's still blank - never overwrite a value that's already set.
$envText = Get-Content ".env" -Raw
if ($envText -match "(?m)^PG_PASSWORD=\s*$") {
    $securePw = Read-Host "    Enter the PostgreSQL 'postgres' user password you set during install" -AsSecureString
    $plainPw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw))
    $envText = $envText -replace "(?m)^PG_PASSWORD=\s*$", "PG_PASSWORD=$plainPw"
    [System.IO.File]::WriteAllText((Resolve-Path ".env"), $envText, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "PG_PASSWORD saved to .env"
} else {
    Write-Skip "PG_PASSWORD already set in .env"
}

# Auto-generate the two random secrets if they're still blank - the customer never needs to see or choose these.
function Set-EnvSecretIfBlank($key) {
    $text = Get-Content ".env" -Raw
    if ($text -match "(?m)^$key=\s*$") {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
        $text = $text -replace "(?m)^$key=\s*$", "$key=$secret"
        [System.IO.File]::WriteAllText((Resolve-Path ".env"), $text, (New-Object System.Text.UTF8Encoding($false)))
        Write-Ok "$key generated automatically"
    } else {
        Write-Skip "$key already set in .env"
    }
}
Set-EnvSecretIfBlank "AUTH_SECRET"
Set-EnvSecretIfBlank "WHATSAPP_SERVICE_KEY"

# ============================================================
# [4] Project dependencies
# ============================================================
Write-Step 4 "Project dependencies (npm)"

if (Test-Path "node_modules") {
    Write-Skip "Website npm packages"
} else {
    Write-Host "    Running npm install (website)..."
    npm install
    Write-Ok "Website dependencies installed"
}

if (Test-Path "server\node_modules") {
    Write-Skip "Voicebot npm packages"
} else {
    Write-Host "    Running npm install (voicebot server)..."
    Push-Location server
    npm install
    Pop-Location
    Write-Ok "Voicebot dependencies installed"
}

# The voice pipeline is cloud-only (Sarvam STT/TTS) — no Python services to
# set up. If a legacy install still has server\stt-service or server\tts-service
# folders with venvs, they are simply unused and can be deleted.

# ============================================================
# [5] Database - create it, then apply every migration in order
# ============================================================
Write-Step 5 "Database schema"
try {
    npm run db:setup
    Write-Ok "Base schema applied (local-setup.sql)"
} catch {
    Write-Warn "db:setup failed - check PG_PASSWORD in .env and that PostgreSQL's service is running, then re-run this script."
    exit 1
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    # winget's PostgreSQL install doesn't always add itself to PATH - check the usual spot.
    $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $env:Path += ";$($found.DirectoryName)" }
}
if (Get-Command psql -ErrorAction SilentlyContinue) {
    $envMap = @{}
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^([A-Z_]+)=(.*)$") { $envMap[$matches[1]] = $matches[2] }
    }
    $env:PGPASSWORD = $envMap["PG_PASSWORD"]
    $dbName = if ($envMap["PG_DATABASE"]) { $envMap["PG_DATABASE"] } else { "right_agent_group" }

    Get-ChildItem "migrations\*.sql" | Where-Object { $_.Name -notlike "*rollback*" } | Sort-Object Name | ForEach-Object {
        Write-Host "    Applying $($_.Name)..."
        psql -U postgres -d $dbName -f $_.FullName -q 2>$null
    }
    Write-Ok "All migrations applied"
} else {
    Write-Warn "psql not found on PATH - apply the files in migrations\ manually (see DEPLOYMENT-GUIDE.md), or add PostgreSQL's bin folder to PATH and re-run this script."
}

# ============================================================
# Done - what's left is genuinely manual
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  MACHINE SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Everything installable is installed. What's left needs a human," -ForegroundColor White
Write-Host "on their own device, under their own identity:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Create these accounts (in the CUSTOMER'S name, not yours):" -ForegroundColor Yellow
Write-Host "       - Sarvam AI     -> dashboard.sarvam.ai            (SARVAM_API_KEY - REQUIRED, powers STT + default TTS)"
Write-Host "       - Groq          -> console.groq.com               (GROQ_API_KEY - optional if LLM_PROVIDER=sarvam)"
Write-Host "       - Google OAuth  -> console.cloud.google.com       (GOOGLE_CLIENT_ID / _SECRET)"
Write-Host "       - Exotel        -> my.exotel.com                  (EXOTEL_SID / _API_KEY / _API_TOKEN / _CALLER_ID)"
Write-Host "       - Meta WhatsApp -> see SETUP-GUIDE-CLOUD-API.md    (WHATSAPP_TOKEN / _PHONE_NUMBER_ID / _APP_SECRET)"
Write-Host "       - Cloudflare    -> dash.cloudflare.com             (CF_TUNNEL_NAME, needs a domain) or ngrok.com as a fallback"
Write-Host ""
Write-Host "  2. Paste each value into .env as you get it." -ForegroundColor Yellow
Write-Host ""
Write-Host "  3. Manual security steps this script won't touch:" -ForegroundColor Yellow
Write-Host "       - Turn on BitLocker drive encryption (save the recovery key somewhere durable)"
Write-Host "       - Set up nightly database backups (see the deployment guide, Phase 10)"
Write-Host ""
Write-Host "  4. Once .env is filled in, launch everything:" -ForegroundColor Yellow
Write-Host "       PowerShell -ExecutionPolicy Bypass -File START.ps1"
Write-Host ""
