# ==============================================================================
# Push Repository to GitHub Script (PowerShell)
# Usage:
#   $env:GITHUB_TOKEN="ghp_xxxx"
#   .\push-to-github.ps1 -Username <github-username> -RepoName <repo-name> [-Visibility private|public]
# ==============================================================================

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Username,

    [Parameter(Mandatory=$true, Position=1)]
    [string]$RepoName,

    [Parameter(Mandatory=$false, Position=2)]
    [ValidateSet("private", "public")]
    [string]$Visibility = "private"
)

$token = $env:GITHUB_TOKEN

if (-not $token) {
    Write-Host "❌ Error: GITHUB_TOKEN environment variable is not set." -ForegroundColor Red
    Write-Host "Please set it before running this script:" -ForegroundColor Yellow
    Write-Host '  $env:GITHUB_TOKEN = "ghp_your_token_here"' -ForegroundColor Cyan
    Write-Host "  .\push-to-github.ps1 $Username $RepoName $Visibility" -ForegroundColor Cyan
    exit 1
}

$isPrivate = ($Visibility -eq "private")

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  🚀 Pushing to GitHub: $Username/$RepoName" -ForegroundColor Cyan
Write-Host "  🔒 Visibility: $Visibility" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Ensure local git repo
if (-not (Test-Path ".git")) {
    Write-Host "📦 Initializing local git repository..." -ForegroundColor Yellow
    git init
    git branch -M main
}

# 2. Safety check: make sure .env is not tracked
$trackedEnv = git ls-files .env
if ($trackedEnv) {
    Write-Host "⚠️ Removing .env from git index to protect secrets..." -ForegroundColor Yellow
    git rm --cached .env -ErrorAction SilentlyContinue
}

# 3. Check if repo exists on GitHub
$headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "PowerShell-GitHub-Pusher"
}

Write-Host "🔍 Checking repository existence on GitHub..." -ForegroundColor Yellow
$repoExists = $false
try {
    $checkUrl = "https://api.github.com/repos/$Username/$RepoName"
    $checkResp = Invoke-RestMethod -Uri $checkUrl -Headers $headers -Method Get -ErrorAction Stop
    $repoExists = $true
    Write-Host "ℹ️ Repository '$Username/$RepoName' already exists on GitHub." -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) {
        $repoExists = $false
    } else {
        Write-Host "⚠️ Warning: GitHub API check returned: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $repoExists) {
    Write-Host "✨ Creating repository '$Username/$RepoName' on GitHub ($Visibility)..." -ForegroundColor Yellow
    $body = @{
        name      = $RepoName
        private   = $isPrivate
        auto_init = $false
    } | ConvertTo-Json

    try {
        $createResp = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Headers $headers -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
        Write-Host "✅ Repository created successfully!" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to create repository on GitHub: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# 4. Configure remote and push
$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $currentBranch) { $currentBranch = "main" }
Write-Host "🌿 Current branch: $currentBranch" -ForegroundColor Yellow

git remote remove origin 2>$null
git remote add origin "https://${Username}:${token}@github.com/${Username}/${RepoName}.git"

Write-Host "⬆️ Pushing branch '$currentBranch' to GitHub..." -ForegroundColor Yellow
git push -u origin "$currentBranch" --force

# 5. Clean up remote URL so token is never saved in plaintext on disk
git remote set-url origin "https://github.com/${Username}/${RepoName}.git"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  ✅ SUCCESS! Code pushed to GitHub" -ForegroundColor Green
Write-Host "  🔗 https://github.com/$Username/$RepoName" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Green
