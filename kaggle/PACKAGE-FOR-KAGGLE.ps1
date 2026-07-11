# Packages the project into ONE zip for uploading to Kaggle as a PRIVATE dataset.
# Excludes node_modules / venv / .next (reinstalled fresh on Kaggle) but INCLUDES .env
# (that's why the Kaggle dataset must be PRIVATE — it contains your secrets).
#
# Run:  PowerShell -ExecutionPolicy Bypass -File kaggle\PACKAGE-FOR-KAGGLE.ps1
# Output: rag-kaggle.zip on your Desktop

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutZip     = Join-Path ([Environment]::GetFolderPath("Desktop")) "rag-kaggle.zip"
$Staging    = Join-Path $env:TEMP "rag-kaggle-staging"

if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

Write-Host "Copying project (skipping node_modules, venv, .next, backups)..." -ForegroundColor Yellow
robocopy $ProjectDir "$Staging\project" /E `
    /XD node_modules venv .next backups .git __pycache__ `
    /XF tsconfig.tsbuildinfo /NFL /NDL /NJH /NJS | Out-Null

if (Test-Path $OutZip) { Remove-Item -Force $OutZip }
# NOTE: PowerShell's Compress-Archive writes backslash separators inside the
# zip, which Kaggle rejects ("forbidden character in name"). Python's zipfile
# writes proper forward slashes on every platform.
$py = @"
import os, zipfile
staging = r'$Staging'
out = r'$OutZip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(staging):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, staging).replace(os.sep, '/')
            # Kaggle forbids [ ] in names — encode Next.js dynamic-route dirs
            # like [token]; the notebook renames them back after extraction.
            arc = arc.replace('[', '__LB__').replace(']', '__RB__')
            z.write(full, arc)
names = zipfile.ZipFile(out).namelist()
assert not any(c in n for n in names for c in '[]\\\\'), 'unsafe chars remain'
print('entries:', len(names), '(all Kaggle-safe)')
"@
python -c $py
Remove-Item -Recurse -Force $Staging

$size = [math]::Round((Get-Item $OutZip).Length / 1MB, 1)
Write-Host "OK -> $OutZip ($size MB)" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "1. Go to kaggle.com -> Datasets -> New Dataset"
Write-Host "2. Upload rag-kaggle.zip  |  Title: rag-project  |  visibility: PRIVATE (it contains .env secrets!)"
Write-Host "3. Open kaggle\\RUN-ON-KAGGLE.ipynb on Kaggle (Notebooks -> Import), attach the dataset,"
Write-Host "   set Accelerator = GPU T4, Internet = ON, then Run All."
