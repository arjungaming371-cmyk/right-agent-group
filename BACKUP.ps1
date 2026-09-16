# RIGHT AGENT GROUP - DATABASE BACKUP (with 14-day rotation)
#
# Manual run:      PowerShell -ExecutionPolicy Bypass -File BACKUP.ps1
# Schedule daily:  PowerShell -ExecutionPolicy Bypass -File BACKUP.ps1 -Install
#                  (creates a Windows Task Scheduler job at 2:00 AM daily)
#
# Why this matters: this laptop IS the production server. If the disk dies,
# every lead, call transcript, and loan application dies with it. A daily
# pg_dump into a separate folder (ideally synced to Google Drive/OneDrive)
# is the single cheapest insurance the business can have.

param([switch]$Install)

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir  = Join-Path $ProjectDir "backups"
$KeepDays   = 14

# ---- Install mode: register a daily scheduled task and exit ----
if ($Install) {
    $action  = New-ScheduledTaskAction -Execute "PowerShell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ProjectDir\BACKUP.ps1`""
    $trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
    Register-ScheduledTask -TaskName "RightAgentGroup-DB-Backup" `
        -Action $action -Trigger $trigger -Force | Out-Null
    Write-Host "OK Scheduled daily backup at 2:00 AM (task: RightAgentGroup-DB-Backup)" -ForegroundColor Green
    Write-Host "TIP Point $BackupDir at a Google Drive / OneDrive synced folder for off-laptop safety." -ForegroundColor Yellow
    exit 0
}

# ---- Read DB settings from .env ----
$envFile = Join-Path $ProjectDir ".env"
if (-not (Test-Path $envFile)) { Write-Host "ERROR: .env not found" -ForegroundColor Red; exit 1 }
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') { $envVars[$Matches[1]] = $Matches[2] }
}
$pgHost = if ($envVars["PG_HOST"])     { $envVars["PG_HOST"] }     else { "localhost" }
$pgPort = if ($envVars["PG_PORT"])     { $envVars["PG_PORT"] }     else { "5432" }
$pgDb   = if ($envVars["PG_DATABASE"]) { $envVars["PG_DATABASE"] } else { "right_agent_group" }
$pgUser = if ($envVars["PG_USER"])     { $envVars["PG_USER"] }     else { "postgres" }
$env:PGPASSWORD = $envVars["PG_PASSWORD"]

# ---- Find pg_dump ----
$pgDump = Get-Command "pg_dump" -ErrorAction SilentlyContinue
if (-not $pgDump) {
    $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending
    if ($candidates) { $pgDump = $candidates[0].FullName } else {
        Write-Host "ERROR: pg_dump not found. Add PostgreSQL\bin to PATH." -ForegroundColor Red; exit 1
    }
} else { $pgDump = $pgDump.Source }

# ---- Run the backup ----
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$file  = Join-Path $BackupDir "rag_$stamp.dump"

Write-Host "Backing up '$pgDb' -> $file" -ForegroundColor Yellow
# FIXED: pass the password non-interactively — without this, pg_dump prompts
# for a password and the hidden 2 AM scheduled task hangs forever, silently
# producing NO backups.
if ($envVars["PG_PASSWORD"]) { $env:PGPASSWORD = $envVars["PG_PASSWORD"] }
& $pgDump -h $pgHost -p $pgPort -U $pgUser -d $pgDb -F c -f $file
$dumpExit = $LASTEXITCODE
$env:PGPASSWORD = $null
if ($dumpExit -ne 0) { Write-Host "ERROR: pg_dump failed" -ForegroundColor Red; exit 1 }

$sizeMb = [math]::Round((Get-Item $file).Length / 1MB, 2)
Write-Host "OK Backup complete ($sizeMb MB)" -ForegroundColor Green

# ---- Rotate: delete backups older than $KeepDays ----
$deleted = 0
Get-ChildItem $BackupDir -Filter "rag_*.dump" | Where-Object {
    $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays)
} | ForEach-Object { Remove-Item $_.FullName -Force; $deleted++ }
if ($deleted -gt 0) { Write-Host "Rotated out $deleted old backup(s) (keeping $KeepDays days)" -ForegroundColor Gray }

# Restore command (for reference):
#   pg_restore -h localhost -U postgres -d right_agent_group --clean --if-exists backups\rag_DATE.dump
