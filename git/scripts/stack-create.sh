#!/usr/bin/env bash
set -euo pipefail
# usage: git scr ticket-1234 summary of this change

if [[ $# -lt 2 ]]; then
    echo "usage: git scr <ticket|chore> <description...>" >&2
    exit 1
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
if [[ -z "$repo" ]] || ! gh api "repos/$repo/stacks?per_page=1" --silent >/dev/null 2>&1; then
    echo "GitHub Stacked PRs are not enabled for this repository; use 'git cr' instead" >&2
    exit 1
fi

ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
shift
summary="$*"
slug=$(printf '%s' "$summary" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')

if [[ -z "$slug" ]]; then
    echo "description must produce a non-empty branch name" >&2
    exit 1
fi

prefix=$(git config --get stack.branchPrefix || printf '%s' 'ava.silver/')
prefix="${prefix%/}/"
branch="${prefix}${ticket}/${slug}"

if [[ "$ticket" == "chore" ]]; then
    message="chore: $summary"
else
    message="[$(printf '%s' "$ticket" | tr '[:lower:]' '[:upper:]')] $summary"
fi

stack_json=$(gh stack view --json 2>/dev/null || true)

if [[ -n "$stack_json" ]] && jq -e '.branches[]? | select(.isCurrent)' <<<"$stack_json" >/dev/null; then
    # In a tree stack, adding a stack node creates a new child off the current branch regardless of whether children already exist
    gh stack add --all --message "$message" "$branch"
else
    # Not inside an existing stack context, start a new one from the current branch
    gh stack init "$branch"
    git add -A
    git commit -m "$message"
fi

gh stack submit --auto --open
