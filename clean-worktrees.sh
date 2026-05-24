#!/bin/bash

# Removes worktrees whose branches have been merged or whose PRs are closed.
# Prompts before each removal (default: yes).

# you can also set this as a git alias with:
# git config --global alias.cwt '!bash /path/to/clean-worktrees.sh'

main_branch=$(git main)
main_worktree=$(git worktree list | head -1 | awk '{print $1}')

found=false
wt_path=""

while IFS= read -r line; do
    if [[ "$line" =~ ^worktree\ (.+) ]]; then
        wt_path="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^branch\ refs/heads/(.+) ]]; then
        branch="${BASH_REMATCH[1]}"

        # Skip main worktree
        [[ "$wt_path" = "$main_worktree" ]] && continue

        reason=""

        if command -v gh &>/dev/null; then
            pr_state=$(gh pr view "$branch" --json state --jq '.state' 2>/dev/null || true)
            if [[ -z "$pr_state" ]]; then
                # No PR for this branch — leave it alone.
                continue
            elif [[ "$pr_state" = "MERGED" ]]; then
                reason="PR merged"
            elif [[ "$pr_state" = "CLOSED" ]]; then
                reason="PR closed"
            fi
        elif git branch --merged "$main_branch" --format='%(refname:short)' 2>/dev/null | grep -qxF "$branch"; then
            reason="merged into $main_branch"
        fi

        if [[ -n "$reason" ]]; then
            found=true
            echo "Worktree: $wt_path"
            echo "Branch:   $branch ($reason)"
            if gum confirm "Remove this worktree?" </dev/tty; then
                git worktree remove --force "$wt_path"
                [[ -d "$wt_path" ]] && rm -rf "$wt_path"
                echo "Removed."
            else
                echo "Skipped."
            fi
            echo
        fi
    fi
done < <(git worktree list --porcelain)

if [[ "$found" = false ]]; then
    echo "No unused worktrees found."
fi
