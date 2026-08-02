#!/usr/bin/env bash
set -euo pipefail
# Sync the current GitHub stack, force-with-lease push rebased branches, and verify PR heads.

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

build_script_command() {
    local bash_command
    printf -v bash_command '%q ' "$@"
    bash_command=${bash_command//\'/\'\\\'\'}
    printf "exec bash -c '%s'" "$bash_command"
}

sync_result=''
run_sync() {
    local output exit_code transcript shell_command

    if [[ -t 0 ]] && [[ -t 1 ]] && [[ -t 2 ]]; then
        transcript=$(mktemp)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if script -q -e "$transcript" gh stack sync "$@"; then
                exit_code=0
            else
                exit_code=$?
            fi
        else
            shell_command=$(build_script_command gh stack sync "$@")
            if script -q -e -c "$shell_command" "$transcript"; then
                exit_code=0
            else
                exit_code=$?
            fi
        fi
        sync_result=$(clean_terminal <"$transcript")
        rm -f "$transcript"
        return "$exit_code"
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        if output=$(script -q -e /dev/null gh stack sync "$@" </dev/null 2>&1); then
            exit_code=0
        else
            exit_code=$?
        fi
    else
        shell_command=$(build_script_command gh stack sync "$@")
        if output=$(script -q -e -c "$shell_command" /dev/null </dev/null 2>&1); then
            exit_code=0
        else
            exit_code=$?
        fi
    fi
    sync_result=$(printf '%s' "$output" | clean_terminal)
    printf '%s\n' "$sync_result" >&2
    return "$exit_code"
}

for arg in "$@"; do
    case "$arg" in
        -h|--help) exec gh stack sync --help ;;
    esac
done

stack_json=$(gh stack view --json 2>/dev/null || true)
[[ -n "$stack_json" ]] || fail "current branch is not part of a GitHub stack"

# gh stack sync can return success after its normal push is rejected by a rebase.
# Push only after its final status confirms reconciliation was not cancelled.
push_args=()
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
    case "${args[$i]}" in
        --remote)
            [[ $((i + 1)) -lt ${#args[@]} ]] || fail "--remote requires a value"
            push_args+=(--remote "${args[$((i + 1))]}")
            i=$((i + 1))
            ;;
        --remote=*)
            push_args+=("${args[$i]}")
            ;;
    esac
done

run_sync "$@"
if ! grep -Eq '^(✓ )?(Stack|Branches) synced$' <<<"$sync_result"; then
    fail "gh stack sync did not complete; branches were not pushed"
fi
gh stack push "${push_args[@]}"

stack_json=$(gh stack view --json 2>/dev/null || true)
[[ -n "$stack_json" ]] || fail "stack synced, but local stack state could not be verified"

verification_rows=$(jq -r '
    .branches[]
    | select(.head != null and (.isMerged | not) and (.isQueued | not))
    | [.name, .head, (.pr.number // "")]
    | @tsv
' <<<"$stack_json") || fail "unable to read local stack state"
[[ -n "$verification_rows" ]] || fail "stack has no active branches to sync"

while IFS=$'\t' read -r branch head pr_number; do
    [[ -n "$branch" ]] || continue
    [[ -n "$pr_number" ]] || continue

    remote_head=''
    for attempt in 1 2 3; do
        remote_head=$(gh pr view "$pr_number" --json headRefOid --jq .headRefOid 2>/dev/null || true)
        [[ "$remote_head" == "$head" ]] && break
        [[ $attempt -eq 3 ]] || sleep 1
    done
    [[ "$remote_head" == "$head" ]] \
        || fail "remote pull request for $branch does not match the local commit"
done <<<"$verification_rows"

success "Stack synced and pushed"
