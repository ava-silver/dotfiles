#!/bin/bash

# Removes worktrees whose branches have been merged or whose PRs are closed.
# Collects all candidates and prompts for every removal before removing any.

# you can also set this as a git alias with:
# git config --global alias.cwt '!bash /path/to/clean-worktrees.sh'

main_branch=$(git main)
main_worktree=$(git worktree list | head -1 | awk '{print $1}')

wt_path=""
wt_paths=()
branches=()
reasons=()

# Find every candidate before prompting so removals do not interrupt selection.
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
            wt_paths+=("$wt_path")
            branches+=("$branch")
            reasons+=("$reason")
        fi
    fi
done < <(git worktree list --porcelain)

if [[ ${#wt_paths[@]} -eq 0 ]]; then
    echo "No unused worktrees found."
    exit 0
fi

echo "Unused worktrees:"
for ((i = 0; i < ${#wt_paths[@]}; i++)); do
    echo "  ${wt_paths[$i]}"
    echo "    ${branches[$i]} (${reasons[$i]})"
done
echo

selected=()
if gum confirm "Remove all ${#wt_paths[@]} worktrees?" </dev/tty; then
    for ((i = 0; i < ${#wt_paths[@]}; i++)); do
        selected+=("$i")
    done
else
    echo
    echo "Choose worktrees to remove:"
    for ((i = 0; i < ${#wt_paths[@]}; i++)); do
        echo "Worktree: ${wt_paths[$i]}"
        echo "Branch:   ${branches[$i]} (${reasons[$i]})"
        if gum confirm "Remove this worktree?" </dev/tty; then
            selected+=("$i")
        else
            echo "Skipped."
        fi
        echo
    done
fi

# Perform slow removals only after every selection has been made.
for i in "${selected[@]}"; do
    echo "Removing ${wt_paths[$i]}..."
    git worktree remove --force "${wt_paths[$i]}"
    [[ -d "${wt_paths[$i]}" ]] && rm -rf "${wt_paths[$i]}"
    echo "Removed."
done
