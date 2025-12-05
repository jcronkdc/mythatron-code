#!/bin/bash
# MythaTron Code - Streamlined GitHub Push Script
# Usage: ./scripts/push.sh [commit-message]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}       MythaTron Code - GitHub Push Workflow${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 1. Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}Error: Not a git repository${NC}"
    exit 1
fi

# 2. Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${YELLOW}📝 Uncommitted changes detected${NC}"
    git status --short
    echo ""
    
    # If commit message provided, use it
    if [[ -n "$1" ]]; then
        COMMIT_MSG="$1"
    else
        # Use AI to generate commit message (if claudeCode is available)
        echo -e "${BLUE}Generating commit message...${NC}"
        
        # Get diff for context
        DIFF=$(git diff --staged 2>/dev/null || git diff)
        FILES=$(git diff --name-only --staged 2>/dev/null || git diff --name-only)
        
        # Default message based on files
        if [[ -z "$FILES" ]]; then
            COMMIT_MSG="chore: update files"
        else
            FIRST_FILE=$(echo "$FILES" | head -1)
            FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
            
            if [[ $FILE_COUNT -eq 1 ]]; then
                COMMIT_MSG="update: modify $FIRST_FILE"
            else
                COMMIT_MSG="update: modify $FIRST_FILE and $((FILE_COUNT-1)) other files"
            fi
        fi
        
        echo -e "${YELLOW}Suggested: $COMMIT_MSG${NC}"
        read -p "Use this message? (y/n/custom): " CHOICE
        
        if [[ "$CHOICE" == "n" ]]; then
            read -p "Enter commit message: " COMMIT_MSG
        elif [[ "$CHOICE" != "y" && -n "$CHOICE" ]]; then
            COMMIT_MSG="$CHOICE"
        fi
    fi
    
    # Stage and commit
    echo -e "${GREEN}📦 Staging all changes...${NC}"
    git add -A
    
    echo -e "${GREEN}💾 Committing...${NC}"
    git commit -m "$COMMIT_MSG"
fi

# 3. Check remote
REMOTE=$(git remote 2>/dev/null | head -1)
if [[ -z "$REMOTE" ]]; then
    echo -e "${YELLOW}⚠️  No remote configured${NC}"
    read -p "Enter GitHub repo URL (or press Enter to skip push): " REPO_URL
    
    if [[ -n "$REPO_URL" ]]; then
        git remote add origin "$REPO_URL"
        REMOTE="origin"
        echo -e "${GREEN}✅ Remote added${NC}"
    else
        echo -e "${YELLOW}Skipping push - no remote configured${NC}"
        exit 0
    fi
fi

# 4. Get current branch
BRANCH=$(git branch --show-current)
echo -e "${BLUE}📍 Branch: $BRANCH${NC}"

# 5. Check if upstream is set
if ! git rev-parse --abbrev-ref --symbolic-full-name @{u} > /dev/null 2>&1; then
    echo -e "${YELLOW}Setting upstream for $BRANCH...${NC}"
    git push -u "$REMOTE" "$BRANCH"
else
    # 6. Pull first to avoid conflicts
    echo -e "${BLUE}⬇️  Pulling latest changes...${NC}"
    git pull --rebase "$REMOTE" "$BRANCH" 2>/dev/null || true
    
    # 7. Push
    echo -e "${GREEN}⬆️  Pushing to $REMOTE/$BRANCH...${NC}"
    git push "$REMOTE" "$BRANCH"
fi

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Successfully pushed to GitHub!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Show recent commits
echo -e "${BLUE}Recent commits:${NC}"
git log --oneline -5
