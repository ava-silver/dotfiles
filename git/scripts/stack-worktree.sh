#!/usr/bin/env bash
set -euo pipefail
# usage:
#   git swt ticket-1234 summary of this change  # new stack in a worktree
#   git swt                                     # eject current stack branch

copy_agents_local() {
    local repo_root="$1" wt_dir="$2"
    [[ ! -f "$repo_root/AGENTS.local.md" ]] || cp "$repo_root/AGENTS.local.md" "$wt_dir/AGENTS.local.md"
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
    printf '%s\n' "$HOME/dd/${repo_name}.worktrees/${safe_branch}"
}

if [[ $# -eq 0 ]]; then
    branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$branch" == "$trunk_branch" ]]; then
        echo "already on $trunk_branch, nothing to eject" >&2
        exit 1
    fi

    wt_dir=$(wt_dir_for_branch "$branch")
    [[ ! -d "$wt_dir" ]] || { echo "worktree already exists at $wt_dir" >&2; exit 1; }

    # gh-stack stores metadata in the current worktree's git directory.
    # Copy it so the ejected worktree retains local stack tracking.
    source_git_dir=$(git rev-parse --absolute-git-dir)
    git checkout --quiet "$trunk_branch"
    git worktree add --quiet "$wt_dir" "$branch"
    target_git_dir=$(git -C "$wt_dir" rev-parse --absolute-git-dir)
    [[ ! -f "$source_git_dir/gh-stack" ]] || cp "$source_git_dir/gh-stack" "$target_git_dir/gh-stack"
    copy_agents_local "$repo_root" "$wt_dir"
    echo "$wt_dir"
    zed "$wt_dir"
    exit 0
fi

if [[ $# -lt 2 ]]; then
    echo "usage: git swt <ticket> <description...>" >&2
    exit 1
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
if [[ -z "$repo" ]] || ! gh api "repos/$repo/stacks?per_page=1" --silent >/dev/null 2>&1; then
    echo "GitHub Stacked PRs are not enabled for this repository; use 'git wt' instead" >&2
    exit 1
fi

ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
shift
slug=$(printf '%s' "$*" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
if [[ -z "$slug" ]]; then
    echo "description must produce a non-empty branch name" >&2
    exit 1
fi
prefix=$(git config --get stack.branchPrefix || printf '%s' 'ava.silver/')
prefix="${prefix%/}/"
branch="${prefix}${ticket}/${slug}"
wt_dir=$(wt_dir_for_branch "$branch")

[[ ! -d "$wt_dir" ]] || { echo "worktree already exists at $wt_dir" >&2; exit 1; }

git worktree add --quiet -b "$branch" "$wt_dir" "$trunk_branch"
(
    cd "$wt_dir"
    gh stack init --base "$trunk_branch" "$branch"
)
copy_agents_local "$repo_root" "$wt_dir"
echo "$wt_dir"
zed "$wt_dir"
