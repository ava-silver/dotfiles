#!/bin/bash
set -euo pipefail
# usage:
# worktree.sh ticket-1234 summary of this change   # create a new branch off trunk in a worktree
# worktree.sh                                       # eject the current branch into a worktree
#
# git config --global alias.wt '!$HOME/dotfiles/git/scripts/worktree.sh'
#
# Prints the worktree path on success and opens it in zed.

# copy_agents_local <repo_root> <wt_dir>
# Copies top-level AGENTS.local.md from repo_root into wt_dir, if present.
copy_agents_local() {
    local repo_root="$1" wt_dir="$2"
    if [[ -f "$repo_root/AGENTS.local.md" ]]; then
        cp "$repo_root/AGENTS.local.md" "$wt_dir/AGENTS.local.md"
    fi
}

repo_root=$(git rev-parse --show-toplevel)
repo_name=$(basename "$repo_root")
trunk_branch=$(git main)

wt_dir_for_branch() {
    local branch="$1" safe_branch
    if [[ "$branch" == */*/* ]]; then
        safe_branch="${branch#*/*/}"
    elif [[ "$branch" == */* ]]; then
        safe_branch="${branch#*/}"
    else
        safe_branch="$branch"
    fi
    safe_branch="${safe_branch//\//-}"
    echo "$HOME/dd/${repo_name}.worktrees/${safe_branch}"
}

if [ "$#" -eq 0 ]; then
    # eject mode: move the current branch into a new worktree, and reset the
    # main worktree back to trunk without touching the ejected branch's HEAD.
    branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$branch" == "$trunk_branch" ]]; then
        echo "already on $trunk_branch, nothing to eject" >&2
        exit 1
    fi

    wt_dir=$(wt_dir_for_branch "$branch")
    if [[ -d "$wt_dir" ]]; then
        echo "worktree already exists at $wt_dir" >&2
        exit 1
    fi

    git checkout --quiet "$trunk_branch"
    git worktree add --quiet "$wt_dir" "$branch"
    copy_agents_local "$repo_root" "$wt_dir"
    echo "$wt_dir"
    zed "$wt_dir"
    exit 0
fi

if [ "$#" -lt 2 ]; then
    echo "usage: git wt <ticket> <description...>" >&2
    exit 1
fi

ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
shift
desc=$(echo "$*" | tr '[:upper:] ' '[:lower:]-')
branch_prefix=$(gt user branch-prefix 2>/dev/null | sed -n 's/^branch-prefix is set to "\(.*\)"$/\1/p')
branch="${branch_prefix}${ticket}/${desc}"

wt_dir=$(wt_dir_for_branch "$branch")

if [[ -d "$wt_dir" ]]; then
    echo "worktree already exists at $wt_dir" >&2
    exit 1
fi

# create the worktree and branch off trunk without touching the main worktree's HEAD
git worktree add --quiet -b "$branch" "$wt_dir" "$trunk_branch"
gt track "$branch" --parent "$trunk_branch" --cwd "$wt_dir" --force --quiet
copy_agents_local "$repo_root" "$wt_dir"
echo "$wt_dir"
zed "$wt_dir"
