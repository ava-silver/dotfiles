#!/usr/bin/env bash
set -euo pipefail
# usage: git sac summary of this change

if [[ $# -eq 0 ]]; then
    summary=$(gum input --placeholder 'Summary of this change')
else
    summary="$*"
fi

if [[ -z "$summary" ]]; then
    echo "commit summary cannot be empty" >&2
    exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
ticket=""
if [[ "$branch" == */*/* ]]; then
    ticket=$(cut -d '/' -f 2 <<<"$branch" | tr '[:lower:]' '[:upper:]')
    [[ "$ticket" == "CHORE" ]] && ticket=""
fi

message="$summary"
[[ -n "$ticket" ]] && message="[$ticket] $summary"

git add -A
git commit -m "$message"

# A lower-layer commit changes the base of every branch above it.
if gh stack view --json >/dev/null 2>&1; then
    gh stack rebase --no-trunk --upstack
fi
