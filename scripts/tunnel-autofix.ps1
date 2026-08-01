# tunnel-autofix.ps1 — free "permanent" tunnel without owning a domain.
#
# Starts an ngrok tunnel on the account's reserved free static domain (set
# in .env as NGROK_DOMAIN — free ngrok accounts get exactly one, and unlike
# Cloudflare "quick" tunnels it does NOT change between restarts). Because
# the URL is stable, it only needs to be registered in Google Console +
# Meta ONCE, ever — this script still re-confirms the Meta webhook on every
# run (cheap, and catches the rare case it drifted), but no longer NEEDS to
# for the URL itself to keep working.
#
# Was Cloudflare quick tunnels before: those mint a new random URL every
# run, which can never be pre-registered for OAuth/webhooks, and on this
# network its QUIC/UDP transport kept dropping ("no recent network
# activity") even after forcing --protocol http2. ngrok's static domain
# sidesteps both problems.
#
# ONE tunnel only, not two: this free ngrok account allows exactly one
# public hostname online at a time (a second simultaneous `ngrok http`
# process — even on a different local port — silently reused the SAME
# reserved domain instead of erroring, which would have made routing
# between the website and the voicebot undefined). So this tunnel actually
# points at scripts/local-proxy.js (port 3005), which fans back out to
# website:3000 and voicebot-websocket:3002 by path — same idea as
# nginx.conf's VPS routing, just reimplemented locally since nginx isn't
# installed here. Exotel's flow must use wss://<domain>/voicebot.
#
# Called by START.ps1 when CF_TUNNEL_NAME is not set. Needs in .env:
#   NGROK_DOMAIN, WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
#
# When the client hands over a real domain for the live demo: swap
# NGROK_DOMAIN (or move to a named Cloudflare tunnel) and re-register the
# new URL in Google Console + Meta — same one-time step, just once more.

param([string]$ProjectDir = (Split-Path $PSScriptRoot -Parent))

$ErrorActionPreference = "Stop"
$envFile = Join-Path $ProjectDir ".env"
$envText = [IO.File]::ReadAllText($envFile)

function Get-EnvVal([string]$name) {
    if ($envText -match "(?m)^$([regex]::Escape($name))=(\S+)") { return $Matches[1] }
    return ""
}

$domain = Get-EnvVal "NGROK_DOMAIN"
$appId  = Get-EnvVal "WHATSAPP_APP_ID"
$secret = Get-EnvVal "WHATSAPP_APP_SECRET"
$verify = Get-EnvVal "WHATSAPP_VERIFY_TOKEN"
if (-not $domain) {
    Write-Host "      FAIL NGROK_DOMAIN missing in .env - cannot start tunnel" -ForegroundColor Red
    exit 1
}
if (-not $appId -or -not $secret -or -not $verify) {
    Write-Host "      SKIP webhook auto-fix: WHATSAPP_APP_ID / _APP_SECRET / _VERIFY_TOKEN missing in .env" -ForegroundColor Yellow
}

# --- 1. Kill any stale ngrok/proxy (the reserved domain can only be bound by
#        one tunnel at a time — a leftover process from a prior run/crash
#        blocks this one with "domain already in use") ---
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "local-proxy\.js" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# --- 2. Start the local proxy (3005 -> 3000 website / 3002 voicebot by
#        path), then tunnel THAT instead of port 3000 directly ---
Start-Process "node" -ArgumentList "`"$(Join-Path $ProjectDir 'scripts\local-proxy.js')`" 3005" -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 1
Start-Process "ngrok" -ArgumentList "http 3005 --domain=$domain" -WindowStyle Hidden | Out-Null

# --- 3. Wait (max 30s) for ngrok's local API to report the tunnel live ---
$url = $null
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try {
        $tunnels = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:4040/api/tunnels"
        $t = $tunnels.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1
        if ($t) { $url = $t.public_url; break }
    } catch {}
}
if (-not $url) {
    Write-Host "      FAIL ngrok gave no tunnel URL after 30s - WhatsApp webhook NOT updated" -ForegroundColor Red
    exit 1
}
Write-Host "      OK ngrok tunnel URL: $url (stable - same every restart)" -ForegroundColor Green

# --- 4. Self-check the webhook path through the tunnel (website must be up) ---
# ngrok-skip-browser-warning is REQUIRED on the free plan: Invoke-WebRequest's
# User-Agent contains "Mozilla", so ngrok's edge serves its HTML interstitial
# instead of proxying, and this check reported a dead tunnel that was actually
# fine. Meta's own webhook calls don't look like a browser, so only this
# self-check ever tripped on it.
$reachable = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $ping = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Headers @{ "ngrok-skip-browser-warning" = "1" } -Uri "$url/api/whatsapp?hub.mode=subscribe&hub.verify_token=$verify&hub.challenge=selfping"
        if ($ping.Content -eq "selfping") { $reachable = $true; break }
    } catch {}
    Start-Sleep -Seconds 3
}
if (-not $reachable) {
    Write-Host "      WARN tunnel not answering the webhook self-check after 30s (is the website on port 3000 up?)" -ForegroundColor Yellow
}

# --- 5. Re-point the Meta webhook (app access token = appid|appsecret) ---
if ($appId -and $secret -and $verify) {
    $done = $false
    for ($try = 1; $try -le 3 -and -not $done; $try++) {
        try {
            $resp = Invoke-RestMethod -Method Post -Uri "https://graph.facebook.com/v21.0/$appId/subscriptions" -Body @{
                object       = "whatsapp_business_account"
                callback_url = "$url/api/whatsapp"
                verify_token = $verify
                fields       = "messages"
                access_token = "$appId|$secret"
            }
            if ($resp.success) {
                Write-Host "      OK Meta webhook confirmed at $url/api/whatsapp" -ForegroundColor Green
                $done = $true
            } else {
                Write-Host "      WARN Meta answered without success: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "      WARN Meta webhook update attempt $try failed: $($_.Exception.Message)" -ForegroundColor Yellow
            Start-Sleep -Seconds 10
        }
    }
    if (-not $done) {
        Write-Host "      FAIL Meta webhook NOT confirmed after 3 tries - WhatsApp auto-reply may be broken" -ForegroundColor Red
    }
}

# --- 6. Persist the URL for services that read it at boot (usually a no-op
#        since the domain is stable, but harmless if it ever changes) ---
$envText = $envText -replace "(?m)^NEXT_PUBLIC_APP_URL=\S+", "NEXT_PUBLIC_APP_URL=$url"
[IO.File]::WriteAllText($envFile, $envText, (New-Object Text.UTF8Encoding($false)))
Write-Host "      OK NEXT_PUBLIC_APP_URL confirmed in .env" -ForegroundColor Green
