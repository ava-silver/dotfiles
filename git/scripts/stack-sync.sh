#!/usr/bin/env bash
set -euo pipefail
# Sync the current GitHub stack, relying on gh stack for reconciliation and verification.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
# Resolved relative to this script at runtime.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/stack-common.sh"

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

fail() {
    if color_enabled 2; then
        printf '\033[31m%s\033[0m\n' "$1" >&2
    else
        printf '%s\n' "$1" >&2
    fi
    exit "${2:-1}"
}

for arg in "$@"; do
    case "$arg" in
        -h|--help) exec gh stack sync --help ;;
    esac
done

current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
stack_file=$(git rev-parse --git-path gh-stack 2>/dev/null || true)
stack_json=''
if [[ -n "$current_branch" ]] && [[ -f "$stack_file" ]]; then
    stack_json=$(jq -ce --arg branch "$current_branch" '
        [.stacks[] | select(
            .trunk.branch == $branch or any(.branches[]?; .branch == $branch)
        )]
        | select(length == 1)
        | .[0]
    ' "$stack_file" 2>/dev/null || true)
fi
[[ -n "$stack_json" ]] || fail "current branch is not part of exactly one GitHub stack"
branch_count=$(jq '[.branches[] | select(.pullRequest.merged != true)] | length' <<<"$stack_json") \
    || fail "unable to read local stack state"
[[ "$branch_count" -gt 0 ]] || fail "stack has no active branches to sync"

progress "Syncing $branch_count stack branch$([[ "$branch_count" -eq 1 ]] || printf 'es')..."

# Preserve gh's interactive conflict/divergence prompts. In noninteractive use,
# suppress routine status output while retaining the original error.
if [[ -t 0 ]] && [[ -t 1 ]] && [[ -t 2 ]]; then
    gh stack sync "$@"
else
    output=''
    if output=$(stack_run_noninteractive gh stack sync "$@"); then
        :
    else
        exit_code=$?
        [[ -n "$output" ]] && printf '%s\n' "$output" >&2
        exit "$exit_code"
    fi
fi

success "Stack synced"
