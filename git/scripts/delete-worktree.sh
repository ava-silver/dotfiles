#!/bin/bash
set -euo pipefail

# Interactively removes a clean linked worktree.
# usage: git dwt

worktrees=()
worktree_path=""
branch=""
first=true

add_worktree() {
    [[ -z "$worktree_path" ]] && return

    # The first entry is the primary worktree and cannot be removed.
    if [[ "$first" = true ]]; then
        first=false
    else
        worktrees+=("$worktree_path"$'\t'"${branch:-detached HEAD}")
    fi

    worktree_path=""
    branch=""
}

while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
        "worktree "*) worktree_path=${line#worktree } ;;
        "branch refs/heads/"*) branch=${line#branch refs/heads/} ;;
        "") add_worktree ;;
    esac
done < <(git worktree list --porcelain)
add_worktree

if [[ ${#worktrees[@]} -eq 0 ]]; then
    echo "No linked worktrees found."
    exit 0
fi

selection=$(printf '%s\n' "${worktrees[@]}" | fzf --delimiter=$'\t' --with-nth=2.. --prompt='Delete worktree: ') || exit 0
path=${selection%%$'\t'*}

if [[ -n $(git -C "$path" status --porcelain --untracked-files=all) ]]; then
    echo "Worktree is not clean: $path" >&2
    exit 1
fi

if ! gum confirm "Remove clean worktree $path?" </dev/tty; then
    echo "Skipped."
    exit 0
fi

# `git status` ignores ignored build artifacts, while `git worktree remove`
# refuses to delete a non-empty directory. They are safe to discard after the
# cleanliness check above.
git -C "$path" clean -fdX
git worktree remove "$path"
echo "Removed: $path"
