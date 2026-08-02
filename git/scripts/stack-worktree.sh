#!/usr/bin/env bash
set -euo pipefail
# usage:
#   git swt ticket-1234 summary of this change  # new stack in a worktree
#   git swt                                     # eject current stack branch

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
# Resolved relative to this script at runtime.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/stack-common.sh"

color_enabled() {
    [[ -t "$1" ]] && [[ "${TERM:-}" != "dumb" ]] && [[ -z "${NO_COLOR:-}" ]]
}

fail() {
    if color_enabled 2; then
        printf '\033[31m%s\033[0m\n' "$1" >&2
    else
        printf '%s\n' "$1" >&2
    fi
    exit "${2:-1}"
}

copy_agents_local() {
    local repo_root="$1" wt_dir="$2"
    [[ ! -f "$repo_root/AGENTS.local.md" ]] || cp "$repo_root/AGENTS.local.md" "$wt_dir/AGENTS.local.md"
}

open_editor() {
    command -v zed >/dev/null 2>&1 || return 0
    zed "$1" >/dev/null 2>&1 || true
}

clean_terminal() {
    perl -pe 's/\^D\x08\x08//g; s/\r//g; s/\e\][^\a\e]*(?:\a|\e\\)//g; s/\e\[[0-?]*[ -\/]*[\@-~]//g; s/\x08//g'
}

run_quietly() {
    local output exit_code cleaned
    if output=$(stack_run_noninteractive "$@"); then
        return 0
    else
        exit_code=$?
    fi
    cleaned=$(printf '%s' "$output" | clean_terminal | sed '/^[[:space:]]*$/d')
    [[ -n "$cleaned" ]] || cleaned="command failed: $*"
    fail "$cleaned" "$exit_code"
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
[[ -n "$repo_root" ]] || fail "git swt requires a Git repository"
repo_name=$(basename "$repo_root")
trunk_branch=$(git main 2>/dev/null || true)
[[ -n "$trunk_branch" ]] || fail "unable to determine the repository trunk branch"

wt_dir_for_branch() {
    local safe_branch="${1//\//-}"
    printf '%s\n' "$HOME/dd/${repo_name}.worktrees/${safe_branch}"
}

if [[ $# -eq 0 ]]; then
    branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
    [[ -n "$branch" ]] || fail "git swt requires a checked-out branch"
    [[ "$branch" != "$trunk_branch" ]] || fail "already on $trunk_branch, nothing to eject"
    [[ -z "$(git status --porcelain)" ]] \
        || fail "working tree has uncommitted changes; commit or stash them before ejecting"

    stack_json=$(gh stack view --json 2>/dev/null || true)
    jq -e '.branches[]? | select(.isCurrent)' <<<"$stack_json" >/dev/null 2>&1 \
        || fail "current branch is not part of a GitHub stack; use 'git wt' instead"

    wt_dir=$(wt_dir_for_branch "$branch")
    [[ ! -e "$wt_dir" ]] && [[ ! -L "$wt_dir" ]] \
        || fail "worktree path already exists: $wt_dir"

    source_git_dir=$(git rev-parse --absolute-git-dir)
    source_metadata="$source_git_dir/gh-stack"
    [[ -f "$source_metadata" ]] || fail "GitHub stack metadata is missing"
    stack_matches=$(jq --arg branch "$branch" \
        '[.stacks[] | select(any(.branches[]?; .branch == $branch))] | length' \
        "$source_metadata")
    [[ "$stack_matches" == 1 ]] || fail "current branch must belong to exactly one local GitHub stack"
    selected_stack_index=$(jq -r --arg branch "$branch" '
        [.stacks | to_entries[] | select(any(.value.branches[]?; .branch == $branch)) | .key][0]
    ' "$source_metadata")
    selected_stack_trunk=$(jq -r --arg branch "$branch" '
        [.stacks[] | select(any(.branches[]?; .branch == $branch)) | .trunk.branch][0]
    ' "$source_metadata")

    metadata_backup=$(mktemp)
    cp "$source_metadata" "$metadata_backup"
    source_modify_state="$source_git_dir/gh-stack-modify-state"
    modify_state_backup=''
    if [[ -f "$source_modify_state" ]]; then
        modify_state_index=$(jq -r '.stack_index // empty' "$source_modify_state" 2>/dev/null || true)
        modify_state_name=$(jq -r '.stack_name // empty' "$source_modify_state" 2>/dev/null || true)
        [[ "$modify_state_index" == "$selected_stack_index" ]] \
            && [[ "$modify_state_name" == "$selected_stack_trunk" ]] \
            || fail "pending GitHub stack modify state belongs to a different stack"
        modify_state_backup=$(mktemp)
        cp "$source_modify_state" "$modify_state_backup"
    fi
    original_branch="$branch"
    switched_to_trunk=false
    created_worktree=false
    metadata_moved=false
    modify_state_moved=false
    # Invoked by the EXIT trap.
    # shellcheck disable=SC2329
    rollback_eject() {
        local exit_code=$?
        trap - EXIT
        if [[ "$metadata_moved" == true ]]; then
            cp "$metadata_backup" "$source_metadata" >/dev/null 2>&1 || true
        fi
        if [[ "$modify_state_moved" == true ]] && [[ -n "$modify_state_backup" ]]; then
            cp "$modify_state_backup" "$source_modify_state" >/dev/null 2>&1 || true
        fi
        if [[ "$created_worktree" == true ]]; then
            git worktree remove --force "$wt_dir" >/dev/null 2>&1 || true
        fi
        if [[ "$switched_to_trunk" == true ]]; then
            git switch --quiet "$original_branch" >/dev/null 2>&1 || true
        fi
        rm -f "$metadata_backup"
        [[ -z "$modify_state_backup" ]] || rm -f "$modify_state_backup"
        exit "$exit_code"
    }
    trap rollback_eject EXIT

    git switch --quiet "$trunk_branch"
    switched_to_trunk=true
    git worktree add --quiet "$wt_dir" "$branch"
    created_worktree=true

    target_git_dir=$(git -C "$wt_dir" rev-parse --absolute-git-dir)
    target_metadata_tmp="$target_git_dir/gh-stack.tmp.$$"
    source_metadata_tmp="$source_git_dir/gh-stack.tmp.$$"
    jq --arg branch "$branch" '
        . as $root
        | {
            schemaVersion: $root.schemaVersion,
            repository: $root.repository,
            stacks: [$root.stacks[] | select(any(.branches[]?; .branch == $branch))]
        }
    ' "$metadata_backup" >"$target_metadata_tmp"
    jq --arg branch "$branch" '
        .stacks |= map(select(any(.branches[]?; .branch == $branch) | not))
    ' "$metadata_backup" >"$source_metadata_tmp"
    mv "$target_metadata_tmp" "$target_git_dir/gh-stack"
    mv "$source_metadata_tmp" "$source_metadata"
    metadata_moved=true
    if [[ -n "$modify_state_backup" ]]; then
        jq '.stack_index = 0' "$modify_state_backup" >"$target_git_dir/gh-stack-modify-state"
        rm -f "$source_modify_state"
        modify_state_moved=true
    fi

    copy_agents_local "$repo_root" "$wt_dir"
    (
        cd "$wt_dir"
        gh stack view --json >/dev/null 2>&1
    ) || fail "worktree created, but GitHub stack metadata could not be transferred"

    trap - EXIT
    rm -f "$metadata_backup"
    [[ -z "$modify_state_backup" ]] || rm -f "$modify_state_backup"
    printf '%s\n' "$wt_dir"
    open_editor "$wt_dir"
    exit 0
fi

[[ $# -ge 2 ]] || fail "usage: git swt <ticket> <description...>"

ticket=$(basename "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')
shift
summary="$*"
slug=$(printf '%s' "$summary" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
[[ -n "$slug" ]] || fail "description must produce a non-empty branch name"

prefix=$(git config --get stack.branchPrefix || true)
[[ -n "$prefix" ]] || prefix='ava.silver/'
prefix="${prefix%/}/"
branch="${prefix}${ticket}/${slug}"
wt_dir=$(wt_dir_for_branch "$branch")

[[ ! -e "$wt_dir" ]] && [[ ! -L "$wt_dir" ]] \
    || fail "worktree path already exists: $wt_dir"
git show-ref --verify --quiet "refs/heads/$branch" && fail "branch already exists: $branch"

repo_json=''
if ! repo_json=$(gh repo view --json nameWithOwner 2>&1); then
    fail "$(printf 'unable to determine the GitHub repository:\n%s' "$repo_json")"
fi
repo=$(jq -r '.nameWithOwner // empty' <<<"$repo_json")
[[ -n "$repo" ]] || fail "unable to determine the GitHub repository"

stack_check=''
if ! stack_check=$(gh api "repos/$repo/stacks?per_page=1" --silent 2>&1); then
    if [[ "$stack_check" == *"HTTP 404"* ]]; then
        fail "GitHub Stacked PRs are not enabled for this repository; use 'git wt' instead"
    else
        fail "$(printf 'unable to verify GitHub Stacked PRs availability:\n%s' "$stack_check")"
    fi
fi

remote_refs=$(gh api "repos/$repo/git/matching-refs/heads/$branch" 2>&1) \
    || fail "$(printf 'unable to check whether the remote branch exists:\n%s' "$remote_refs")"
if jq -e --arg ref "refs/heads/$branch" '.[] | select(.ref == $ref)' <<<"$remote_refs" >/dev/null; then
    fail "remote branch already exists: $branch"
fi

created_worktree=false
# Invoked by the EXIT trap.
# shellcheck disable=SC2329
rollback_create() {
    local exit_code=$?
    trap - EXIT
    if [[ "$created_worktree" == true ]]; then
        git worktree remove --force "$wt_dir" >/dev/null 2>&1 || true
        git branch -D "$branch" >/dev/null 2>&1 || true
    fi
    exit "$exit_code"
}
trap rollback_create EXIT

git worktree add --quiet -b "$branch" "$wt_dir" "$trunk_branch"
created_worktree=true
(
    cd "$wt_dir"
    run_quietly gh stack init --base "$trunk_branch" "$branch"
)
copy_agents_local "$repo_root" "$wt_dir"

trap - EXIT
printf '%s\n' "$wt_dir"
open_editor "$wt_dir"
