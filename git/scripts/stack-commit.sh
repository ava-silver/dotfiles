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

ticket="$("$SCRIPT_DIR/ticket.sh")"
message="$summary"
[[ -n "$ticket" ]] && message="[$ticket] $summary"

git add -A
git commit -m "$message"

# Refresh stack metadata and cascade-rebase every branch above this commit.
stack_json=''
if stack_json=$(gh stack view --json 2>&1); then
    if ! jq -e '.branches | type == "array"' <<<"$stack_json" >/dev/null; then
        echo "gh stack view returned invalid JSON" >&2
        exit 1
    fi
    if jq -e '.branches[]? | select(.isCurrent)' <<<"$stack_json" >/dev/null; then
        gh stack rebase --no-trunk --upstack
    fi
else
    stack_exit=$?
    if [[ $stack_exit -ne 2 ]]; then
        printf '%s\n' "$stack_json" >&2
        exit "$stack_exit"
    fi
fi
