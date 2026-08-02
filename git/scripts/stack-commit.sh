#!/usr/bin/env bash
set -euo pipefail
# usage: git sac message for this change

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)

if [[ $# -eq 0 ]]; then
    summary=$(gum input --placeholder 'Message for this change')
else
    summary="$*"
fi

if [[ -z "$summary" ]]; then
    echo "commit message cannot be empty" >&2
    exit 1
fi

ticket="$($SCRIPT_DIR/ticket.sh)"
message="$summary"
[[ -n "$ticket" ]] && message="[$ticket] $summary"

git add -A
git commit -m "$message"

# A lower-layer commit changes the base of every branch above it.
if gh stack view --json >/dev/null 2>&1; then
    gh stack rebase --no-trunk --upstack
fi
