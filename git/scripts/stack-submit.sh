#!/usr/bin/env bash
set -euo pipefail
# Submit the current GitHub stack and print URLs only for newly created PRs.

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

render_submit_output() {
    local line
    while IFS= read -r line; do
        case "$line" in
            ''|'Checking stack state...'|'Pushing to '*|\
            'PR '*' is up to date'|'✓ Created PR '*|'✓ Pushed and synced '*|\
            '✓ Stack on GitHub is up to date '*|'✓ Stack created on GitHub '*|\
            '✓ Stack updated on GitHub '*|'✓ Updated base branch for PR '*|\
            '✓ Marked PR '*' as ready for review')
                continue
                ;;
        esac
        printf '%s\n' "$line"
    done
}

run_submit() {
    local output exit_code cleaned

    if output=$(run_pty_capture gh stack submit --auto --open "$@" 2>&1); then
        cleaned=$(printf '%s' "$output" | clean_terminal)
        printf '%s\n' "$cleaned" | render_submit_output
        return 0
    else
        exit_code=$?
    fi

    cleaned=$(printf '%s' "$output" | clean_terminal | sed '/^[[:space:]]*$/d')
    [[ -n "$cleaned" ]] || cleaned='gh stack submit failed'
    printf '%s\n' "$cleaned" >&2
    return "$exit_code"
}

current_stack() {
    local branch stack_file
    branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || return 1
    stack_file=$(git rev-parse --git-path gh-stack 2>/dev/null) || return 1
    [[ -f "$stack_file" ]] || return 1
    jq -ce --arg branch "$branch" '
        [.stacks[] | select(
            .trunk.branch == $branch or any(.branches[]?; .branch == $branch)
        )]
        | select(length == 1)
        | .[0]
    ' "$stack_file" 2>/dev/null
}

for arg in "$@"; do
    case "$arg" in
        -h|--help) exec gh stack submit --help ;;
    esac
done

before=$(current_stack || true)
[[ -n "$before" ]] || fail "current branch is not part of exactly one GitHub stack"
branch_count=$(jq '[.branches[] | select(.pullRequest.merged != true)] | length' <<<"$before") \
    || fail "unable to read local stack state"
[[ "$branch_count" -gt 0 ]] || fail "stack has no active branches to submit"

progress "Submitting $branch_count stack branch$([[ "$branch_count" -eq 1 ]] || printf 'es')..."
run_submit "$@"

after=$(current_stack || true)
[[ -n "$after" ]] || fail "stack submitted, but local stack state could not be refreshed"

new_urls=$(jq -nr --argjson before "$before" --argjson after "$after" '
    $after.branches[] as $branch
    | select($branch.pullRequest.url? != null)
    | select([
        $before.branches[]
        | select(.branch == $branch.branch and .pullRequest.url? != null)
      ] | length == 0)
    | $branch.pullRequest.url
') || fail "stack submitted, but new pull requests could not be identified"

success "Stack submitted"
[[ -z "$new_urls" ]] || printf '%s\n' "$new_urls"
