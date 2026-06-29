#!/bin/bash
set -euo pipefail
# usage:
# worktree.sh ticket-1234 summary of this change
#
# git config --global alias.wt '!$HOME/dotfiles/git/scripts/worktree.sh'
#
# Creates a gt-tracked branch and sets up a worktree for it.
# Prints the worktree path on success.

if [ "$#" -lt 2 ]; then
    echo "usage: git wt <ticket> <description...>" >&2
    exit 1
fi

ticket=$(basename "$1")
shift
branch=$(echo "$ticket/$*" | tr '[:upper:]' '[:lower:]')

repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
starting_branch=$(git symbolic-ref --quiet --short HEAD) || {
    echo "git wt must be run from a named branch, not detached HEAD" >&2
    exit 1
}

gt create "$branch"

actual_branch=$(git symbolic-ref --quiet --short HEAD)

if [[ "$actual_branch" == */*/* ]]; then
    safe_branch="${actual_branch#*/*/}"
elif [[ "$actual_branch" == */* ]]; then
    safe_branch="${actual_branch#*/}"
else
    safe_branch="$actual_branch"
fi
safe_branch="${safe_branch//\//-}"
wt_dir="$HOME/dd/${repo_name}.worktrees/${safe_branch}"

if [[ -d "$wt_dir" ]]; then
    echo "worktree already exists at $wt_dir" >&2
    exit 1
fi

git checkout --quiet "$starting_branch"
git worktree add --quiet "$wt_dir" "$actual_branch"
echo "$wt_dir"
