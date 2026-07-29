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

ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
shift
desc=$(echo "$*" | tr '[:upper:] ' '[:lower:]-')
branch_prefix=$(gt user branch-prefix 2>/dev/null | sed -n 's/^branch-prefix is set to "\(.*\)"$/\1/p')
branch="${branch_prefix}${ticket}/${desc}"

repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
trunk_branch=$(git main)

if [[ "$branch" == */*/* ]]; then
    safe_branch="${branch#*/*/}"
elif [[ "$branch" == */* ]]; then
    safe_branch="${branch#*/}"
else
    safe_branch="$branch"
fi
safe_branch="${safe_branch//\//-}"
wt_dir="$HOME/dd/${repo_name}.worktrees/${safe_branch}"

if [[ -d "$wt_dir" ]]; then
    echo "worktree already exists at $wt_dir" >&2
    exit 1
fi

# create the worktree and branch off trunk without touching the main worktree's HEAD
git worktree add --quiet -b "$branch" "$wt_dir" "$trunk_branch"
gt track "$branch" --parent "$trunk_branch" --cwd "$wt_dir" --force --quiet
echo "$wt_dir"
zed "$wt_dir"
