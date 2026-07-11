# RIGHT AGENT GROUP - AI PERFORMANCE DIGEST EMAIL
#
# Manual run:        PowerShell -ExecutionPolicy Bypass -File DIGEST.ps1
# Manual (weekly):    PowerShell -ExecutionPolicy Bypass -File DIGEST.ps1 -Period weekly
# Schedule daily:     PowerShell -ExecutionPolicy Bypass -File DIGEST.ps1 -Install
#                     (creates a Windows Task Scheduler job at 8:00 AM daily)
#
# Requires ADMIN_EMAIL and SMTP_* to be set in .env — otherwise the digest
# generates fine but the email send is skipped (see /api/digest response).

param([switch]$Install, [string]$Period = "daily")

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- Install mode: register a daily scheduled task and exit ----
if ($Install) {
    $action  = New-ScheduledTaskAction -Execute "PowerShell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ProjectDir\DIGEST.ps1`""
    $trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
    Register-ScheduledTask -TaskName "RightAgentGroup-Digest" `
        -Action $action -Trigger $trigger -Force | Out-Null
    Write-Host "OK Scheduled daily digest email at 8:00 AM (task: RightAgentGroup-Digest)" -ForegroundColor Green
    exit 0
}

# ---- Read settings from .env ----
$envFile = Join-Path $ProjectDir ".env"
if (-not (Test-Path $envFile)) { Write-Host "ERROR: .env not found" -ForegroundColor Red; exit 1 }
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
}
$appUrl  = if ($envVars["APP_INTERNAL_URL"]) { $envVars["APP_INTERNAL_URL"] } else { "http://127.0.0.1:3000" }
$apiKey  = $envVars["WHATSAPP_SERVICE_KEY"]
if (-not $apiKey) { Write-Host "ERROR: WHATSAPP_SERVICE_KEY not set in .env" -ForegroundColor Red; exit 1 }

# ---- Call the digest endpoint ----
try {
    $body = @{ period = $Period } | ConvertTo-Json
    $res = Invoke-RestMethod -Uri "$appUrl/api/digest" -Method Post `
        -Headers @{ "x-api-key" = $apiKey; "Content-Type" = "application/json" } -Body $body
    Write-Host "OK Digest sent — $($res.stats.totalCalls) calls, $($res.stats.qualifiedLeads) qualified" -ForegroundColor Green
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
