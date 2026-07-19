# tunnel-autofix.ps1 — free "permanent" tunnel without a domain.
#
# Starts a Cloudflare QUICK tunnel (new random URL every run), waits for the
# URL, then automatically:
#   1. re-points the Meta WhatsApp webhook at the new URL
#   2. rewrites NEXT_PUBLIC_APP_URL in .env so freshly started services use it
#
# Called by START.ps1 when CF_TUNNEL_NAME is not set. Needs in .env:
#   WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
#
# NOTE: the website (port 3000) must already be running — Meta verifies the
# webhook with a GET through the tunnel the moment we re-subscribe.

param([string]$ProjectDir = (Split-Path $PSScriptRoot -Parent))

$ErrorActionPreference = "Stop"
$envFile = Join-Path $ProjectDir ".env"
$envText = [IO.File]::ReadAllText($envFile)

function Get-EnvVal([string]$name) {
    if ($envText -match "(?m)^$([regex]::Escape($name))=(\S+)") { return $Matches[1] }
    return ""
}

$appId  = Get-EnvVal "WHATSAPP_APP_ID"
$secret = Get-EnvVal "WHATSAPP_APP_SECRET"
$verify = Get-EnvVal "WHATSAPP_VERIFY_TOKEN"
if (-not $appId -or -not $secret -or -not $verify) {
    Write-Host "      SKIP webhook auto-fix: WHATSAPP_APP_ID / _APP_SECRET / _VERIFY_TOKEN missing in .env" -ForegroundColor Yellow
}

# --- 1. Start the quick tunnel, logging to a file we can parse ---
$log = Join-Path $env:TEMP "cf-quick-tunnel.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue
Start-Process "cloudflared" -ArgumentList "tunnel --url http://localhost:3000 --logfile `"$log`"" -WindowStyle Minimized | Out-Null

# --- 2. Wait (max 90s) for the trycloudflare URL to appear in the log ---
$url = $null
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $m = [regex]::Match((Get-Content $log -Raw), "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($m.Success) { $url = $m.Value; break }
    }
}
if (-not $url) {
    Write-Host "      FAIL quick tunnel gave no URL after 90s - WhatsApp webhook NOT updated" -ForegroundColor Red
    exit 1
}
Write-Host "      OK Quick tunnel URL: $url" -ForegroundColor Green

# --- 3. Wait until the tunnel actually serves our webhook (fresh quick
#        tunnels take ~10-30s to go live; Meta's verification GET during the
#        subscribe call fails with 400 if we fire too early) ---
$reachable = $false
for ($i = 0; $i -lt 12; $i++) {
    try {
        $ping = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$url/api/whatsapp?hub.mode=subscribe&hub.verify_token=$verify&hub.challenge=selfping"
        if ($ping.Content -eq "selfping") { $reachable = $true; break }
    } catch {}
    Start-Sleep -Seconds 5
}
if (-not $reachable) {
    Write-Host "      WARN tunnel not answering the webhook self-check after 60s (is the website on port 3000 up?)" -ForegroundColor Yellow
}

# --- 4. Re-point the Meta webhook (app access token = appid|appsecret) ---
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
                Write-Host "      OK Meta webhook re-pointed to $url/api/whatsapp" -ForegroundColor Green
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
        Write-Host "      FAIL Meta webhook NOT updated after 3 tries - WhatsApp auto-reply is broken until this succeeds" -ForegroundColor Red
    }
}

# --- 4. Persist the URL for services that read it at boot ---
$envText = $envText -replace "(?m)^NEXT_PUBLIC_APP_URL=\S+", "NEXT_PUBLIC_APP_URL=$url"
[IO.File]::WriteAllText($envFile, $envText, (New-Object Text.UTF8Encoding($false)))
Write-Host "      OK NEXT_PUBLIC_APP_URL updated in .env (used on next app start)" -ForegroundColor Green
