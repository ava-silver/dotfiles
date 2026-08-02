#!/usr/bin/env bash
set -euo pipefail
# usage: git sac message for this change

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

color_enabled() {
    [[ -t "$1" ]] && [[ "${TERM:-}" != "dumb" ]] && [[ -z "${NO_COLOR:-}" ]]
}

progress() {
    if color_enabled 1; then
        printf '\033[34m→\033[0m %s\n' "$*"
    else
        printf '→ %s\n' "$*"
    fi
}

success() {
    if color_enabled 1; then
        printf '\033[32m✓\033[0m %s\n' "$*"
    else
        printf '✓ %s\n' "$*"
    fi
}

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

progress "Committing changes..."
git add -A
git commit -m "$message"

# Cascade-rebase branches above this commit when the current branch is stacked.
current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
stack_file=$(git rev-parse --git-path gh-stack 2>/dev/null || true)
is_stacked=false
if [[ -n "$current_branch" ]] && [[ -f "$stack_file" ]]; then
    if jq -e --arg branch "$current_branch" '
        any(.stacks[]?.branches[]?; .branch == $branch)
    ' "$stack_file" >/dev/null; then
        is_stacked=true
    fi
fi

if [[ "$is_stacked" == true ]]; then
    progress "Restacking dependent branches..."
    gh stack rebase --no-trunk --upstack
    success "Changes committed and stack restacked"
else
    success "Changes committed"
fi
