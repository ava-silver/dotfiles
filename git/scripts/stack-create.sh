#!/usr/bin/env bash
set -euo pipefail
# usage: git scr ticket-1234 summary of this change

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

fail() {
    if color_enabled 2; then
        printf '\033[31m%s\033[0m\n' "$1" >&2
    else
        printf '%s\n' "$1" >&2
    fi
    exit "${2:-1}"
}

clean_terminal() {
    perl -pe 's/\^D\x08\x08//g; s/\r//g; s/\e\][^\a\e]*(?:\a|\e\\)//g; s/\e\[[0-?]*[ -\/]*[\@-~]//g; s/\x08//g'
}

run_pty_capture() {
    local -a script_command

    if [[ "$OSTYPE" == "darwin"* ]]; then
        script_command=(script -q -e /dev/null "$@")
    else
        local bash_command shell_command
        printf -v bash_command '%q ' "$@"
        bash_command=${bash_command//\'/\'\\\'\'}
        shell_command="exec bash -c '$bash_command'"
        script_command=(script -q -e -c "$shell_command" /dev/null)
    fi

    if [[ -t 0 ]]; then
        "${script_command[@]}"
    else
        "${script_command[@]}" </dev/null
    fi
}

run_quietly() {
    local output exit_code cleaned

    if output=$(run_pty_capture "$@" 2>&1); then
        return 0
    else
        exit_code=$?
    fi

    cleaned=$(printf '%s' "$output" | clean_terminal | sed '/^[[:space:]]*$/d')
    [[ -n "$cleaned" ]] || cleaned="command failed: $*"
    printf '%s\n' "$cleaned" >&2
    return "$exit_code"
}

if [[ $# -lt 2 ]]; then
    fail "usage: git scr <ticket|chore> <description...>"
fi

ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
shift
summary="$*"
slug=$(printf '%s' "$summary" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
[[ -n "$slug" ]] || fail "description must produce a non-empty branch name"

current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [[ -z "$current_branch" ]] || ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    fail "git scr requires a repository with a checked-out branch and at least one commit"
fi

default_branch=$(git main 2>/dev/null || true)
[[ -n "$default_branch" ]] || fail "unable to determine the repository trunk branch"

prefix=$(git config --get stack.branchPrefix || true)
[[ -n "$prefix" ]] || prefix='ava.silver/'
prefix="${prefix%/}/"
branch="${prefix}${ticket}/${slug}"
git show-ref --verify --quiet "refs/heads/$branch" && fail "branch already exists: $branch"

if [[ "$ticket" == "chore" ]]; then
    message="chore: $summary"
else
    message="[$(printf '%s' "$ticket" | tr '[:lower:]' '[:upper:]')] $summary"
fi

stack_file=$(git rev-parse --git-path gh-stack 2>/dev/null || true)
stack_json=''
if [[ -f "$stack_file" ]]; then
    stack_json=$(jq -ce --arg branch "$current_branch" '
        [.stacks[] | select(any(.branches[]?; .branch == $branch))]
        | select(length == 1)
        | .[0]
    ' "$stack_file" 2>/dev/null || true)
fi

progress "Creating $branch..."
if [[ -n "$stack_json" ]]; then
    run_quietly gh stack add "$branch"
elif [[ "$current_branch" == "$default_branch" ]]; then
    run_quietly gh stack init "$branch"
else
    run_quietly gh stack init --base "$default_branch" "$current_branch" "$branch"
fi

if [[ -z "$(git status --porcelain)" ]]; then
    success "Created empty stack branch $branch -- nothing to submit"
    exit 0
fi

progress "Committing changes..."
git add -A
git commit -m "$message"

exec "$SCRIPT_DIR/stack-submit.sh"
