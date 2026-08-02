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

clean_ansi() {
    # Strips raw terminal control query garbage and carriage returns
    sed -E $'s/\r//g; s/\x1b\\][0-9]+;[^\x07\x1b]*(\x07|\x1b\\)//g; s/\x1b\\[[0-9;]*[a-zA-Z]//g'
}

run_pty_stream() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        script -q /dev/null "$@" 2>&1
    else
        script -q -c "$*" /dev/null 2>&1
    fi
}

run_quietly() {
    local output exit_code=0

    output=$(run_pty_stream "$@" 2>&1) || exit_code=$?

    if [[ $exit_code -ne 0 ]]; then
        # Clean control garbage, trim whitespace, and format red output cleanly
        local cleaned_err
        cleaned_err=$(printf '%s' "$output" | clean_ansi | sed '/^$/d')
        printf '\033[31m%s\033[0m\n' "$cleaned_err" >&2
        return $exit_code
    fi
}

has_changes() {
    [[ -n "$(git status --porcelain)" ]]
}

stack_json=$(gh stack view --json 2>/dev/null || true)

if [[ -n "$stack_json" ]] && jq -e '.branches[]? | select(.isCurrent)' <<<"$stack_json" >/dev/null; then
    if has_changes; then
        run_quietly gh stack add --all --message "$message" "$branch"
    else
        run_quietly gh stack add "$branch"
        printf '\033[32m✓\033[0m Created empty stack branch \033[1m%s\033[0m\n' "$branch"
        exit 0
    fi
else
    run_quietly gh stack init "$branch"
    if has_changes; then
        git add -A
        git commit -m "$message"
    else
        printf '\033[32m✓\033[0m Initialized stack branch \033[1m%s\033[0m (no changes to submit yet)\n' "$branch"
        exit 0
    fi
fi

# Stream submit output through PTY and filter out low-value noise
run_pty_stream gh stack submit --auto --open \
    | grep --line-buffered -v -E '^(Checking stack state\.\.\.|✓ Created PR #|✓ Pushed and synced)' || true

if pr_url=$(gh pr view "$branch" --json url --jq .url 2>/dev/null) && [[ -n "$pr_url" ]]; then
    printf '\033[32m✓\033[0m Stack submitted successfully: %s\n' "$pr_url"
fi
