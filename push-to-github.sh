#!/usr/bin/env bash
# ==============================================================================
# Push Repository to GitHub Script
# Usage:
#   GITHUB_TOKEN=ghp_xxxx ./push-to-github.sh <github-username> <repo-name> [private|public]
# ==============================================================================

set -e

USERNAME="$1"
REPO_NAME="$2"
VISIBILITY="${3:-private}"

if [ -z "$USERNAME" ] || [ -z "$REPO_NAME" ]; then
    echo "❌ Usage: GITHUB_TOKEN=ghp_xxxx ./push-to-github.sh <github-username> <repo-name> [private|public]"
    echo "Example: GITHUB_TOKEN=ghp_12345 ./push-to-github.sh arjun996625 right-agent-group private"
    exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN environment variable is not set."
    echo "Generate a Personal Access Token at https://github.com/settings/tokens (repo scope required)."
    echo "Then run: GITHUB_TOKEN=your_token ./push-to-github.sh $USERNAME $REPO_NAME $VISIBILITY"
    exit 1
fi

IS_PRIVATE=true
if [ "$VISIBILITY" = "public" ]; then
    IS_PRIVATE=false
fi

echo "=================================================="
echo "  🚀 Pushing to GitHub: $USERNAME/$REPO_NAME"
echo "  🔒 Visibility: $VISIBILITY"
echo "=================================================="

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📦 Initializing local git repository..."
    git init
    git branch -M main
fi

# Safety check: make sure .env is not staged
if git ls-files --error-unmatch .env 2>/dev/null; then
    echo "⚠️ WARNING: .env was tracked in git! Removing from git cache to prevent secret leaks..."
    git rm --cached .env 2>/dev/null || true
fi

# Ensure all current files are committed if any changes exist
if [ -n "$(git status --porcelain)" ]; then
    echo "📝 Committing untracked changes..."
    git add -A
    git commit -m "feat: initial commit with cloud voice and multi-branch support" || true
fi

# 1. Check if the repository already exists on GitHub
echo "🔍 Checking repository existence on GitHub..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$USERNAME/$REPO_NAME")

if [ "$HTTP_STATUS" -eq 404 ]; then
    echo "✨ Repository does not exist. Creating '$USERNAME/$REPO_NAME' on GitHub ($VISIBILITY)..."
    CREATE_RESPONSE=$(curl -s -X POST \
        -H "Authorization: token $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        https://api.github.com/user/repos \
        -d "{\"name\":\"$REPO_NAME\",\"private\":$IS_PRIVATE,\"auto_init\":false}")

    # Verify creation succeeded
    if echo "$CREATE_RESPONSE" | grep -q "\"name\": *\"$REPO_NAME\""; then
        echo "✅ Repository created successfully!"
    else
        echo "❌ Failed to create repository on GitHub:"
        echo "$CREATE_RESPONSE"
        exit 1
    fi
elif [ "$HTTP_STATUS" -eq 200 ]; then
    echo "ℹ️ Repository '$USERNAME/$REPO_NAME' already exists on GitHub. Pushing to existing repo..."
else
    echo "⚠️ GitHub API returned HTTP status $HTTP_STATUS when checking repo."
fi

# 2. Configure remote URL with token for pushing
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "🌿 Current branch: $CURRENT_BRANCH"

# Remove existing origin if configured
git remote remove origin 2>/dev/null || true

# Add remote with token authentication
git remote add origin "https://${USERNAME}:${GITHUB_TOKEN}@github.com/${USERNAME}/${REPO_NAME}.git"

# 3. Push current branch
echo "⬆️ Pushing branch '$CURRENT_BRANCH' to GitHub..."
git push -u origin "$CURRENT_BRANCH" --force

# 4. Clean up token from local git config for security
git remote set-url origin "https://github.com/${USERNAME}/${REPO_NAME}.git"

echo ""
echo "=================================================="
echo "  ✅ SUCCESS! Code pushed to GitHub"
echo "  🔗 URL: https://github.com/$USERNAME/$REPO_NAME"
echo "=================================================="
