#!/usr/bin/env bash
set -euo pipefail
# Submit every active branch in the current GitHub stack and verify the result.

color_enabled() {
    [[ -t "$1" ]] && [[ "${TERM:-}" != "dumb" ]] && [[ -z "${NO_COLOR:-}" ]]
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
            ''|'Checking stack state...'|'Pushing to origin...'|\
            'PR '*' is up to date'|'✓ Created PR '*|'✓ Pushed and synced '*|\
            '✓ Stack on GitHub is up to date '*|'✓ Stack created on GitHub '*|\
            '✓ Stack updated on GitHub '*)
                continue
                ;;
        esac
        printf '%s\n' "$line"
    done
}

run_submit() {
    local output exit_code cleaned

    if [[ -t 1 ]] && [[ -t 2 ]]; then
        gh stack submit --auto --open "$@"
        return
    fi

    if output=$(run_pty_capture gh stack submit --auto --open "$@" 2>&1); then
        exit_code=0
    else
        exit_code=$?
    fi
    cleaned=$(printf '%s' "$output" | clean_terminal)
    if [[ $exit_code -eq 0 ]]; then
        printf '%s\n' "$cleaned" | render_submit_output
    else
        printf '%s\n' "$cleaned" >&2
    fi
    return "$exit_code"
}

for arg in "$@"; do
    case "$arg" in
        -h|--help) exec gh stack submit --help ;;
    esac
done

stack_json=$(gh stack view --json 2>/dev/null || true)
[[ -n "$stack_json" ]] || fail "current branch is not part of a GitHub stack"

run_submit "$@"

stack_json=$(gh stack view --json 2>/dev/null || true)
[[ -n "$stack_json" ]] || fail "stack submitted, but local stack state could not be verified"

ordered_rows=$(jq -r '
    .branches[]
    | select(.head != null and (.isMerged | not))
    | [.name, .head, .isQueued]
    | @tsv
' <<<"$stack_json") || fail "unable to read local stack state"
[[ -n "$ordered_rows" ]] || fail "stack has no active branches to submit"
ordered_count=$(printf '%s\n' "$ordered_rows" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')

active_count=0
expected_base=$(jq -r '.trunk' <<<"$stack_json")
while IFS=$'\t' read -r branch head is_queued; do
    if [[ "$is_queued" == true ]]; then
        expected_base="$branch"
        continue
    fi
    active_count=$((active_count + 1))

    pr_json=$(gh pr view "$branch" --json url,state,headRefOid,baseRefName 2>/dev/null || true)
    [[ -n "$pr_json" ]] || fail "no pull request exists for $branch"
    [[ $(jq -r '.state' <<<"$pr_json") == 'OPEN' ]] || fail "pull request for $branch is not open"
    [[ $(jq -r '.headRefOid' <<<"$pr_json") == "$head" ]] \
        || fail "pull request for $branch does not match the local commit"
    [[ $(jq -r '.baseRefName' <<<"$pr_json") == "$expected_base" ]] \
        || fail "pull request for $branch has the wrong base"
    expected_base="$branch"
done <<<"$ordered_rows"

[[ $active_count -gt 0 ]] || fail "stack has no active branches to submit"

if [[ $ordered_count -gt 1 ]]; then
    repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
    [[ -n "$repo" ]] || fail "unable to determine the GitHub repository"
    remote_pages=$(gh api --paginate --slurp "repos/$repo/stacks?per_page=100" 2>/dev/null || true)
    remote_stacks=$(jq 'add // []' <<<"$remote_pages" 2>/dev/null || true)
    anchor_branch=$(jq -r '[.branches[] | select(.head != null and (.isMerged | not) and (.isQueued | not)) | .name][-1]' <<<"$stack_json")
    remote_heads=$(jq -c --arg branch "$anchor_branch" '
        [.[] | select(any(.pull_requests[]?; .head.ref == $branch))][0]
        | [.pull_requests[]?.head.ref]
    ' <<<"$remote_stacks" 2>/dev/null || true)
    [[ -n "$remote_heads" ]] && [[ "$remote_heads" != 'null' ]] \
        || fail "pull requests were created, but GitHub did not create the remote stack"

    while IFS=$'\t' read -r branch _head is_queued; do
        [[ "$is_queued" == true ]] && continue
        jq -e --arg branch "$branch" 'index($branch) != null' <<<"$remote_heads" >/dev/null \
            || fail "GitHub remote stack is missing $branch"
    done <<<"$ordered_rows"
fi

success "Stack submitted and verified"
