#!/usr/bin/env bash
set -euo pipefail
# usage: git scr ticket-1234 summary of this change

color_enabled() {
    [[ -t "$1" ]] && [[ "${TERM:-}" != "dumb" ]] && [[ -z "${NO_COLOR:-}" ]]
}

print_error() {
    local text="$1"
    if color_enabled 2; then
        printf '\033[31m%s\033[0m\n' "$text" >&2
    else
        printf '%s\n' "$text" >&2
    fi
}

fail() {
    print_error "$1"
    exit "${2:-1}"
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

if [[ -z "$slug" ]]; then
    fail "description must produce a non-empty branch name"
fi

current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [[ -z "$current_branch" ]] || ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    fail "git scr requires a repository with a checked-out branch and at least one commit"
fi

prefix=$(git config --get stack.branchPrefix || true)
[[ -n "$prefix" ]] || prefix='ava.silver/'
prefix="${prefix%/}/"
branch="${prefix}${ticket}/${slug}"

if git show-ref --verify --quiet "refs/heads/$branch"; then
    fail "branch already exists: $branch"
fi

if [[ "$ticket" == "chore" ]]; then
    message="chore: $summary"
else
    message="[$(printf '%s' "$ticket" | tr '[:lower:]' '[:upper:]')] $summary"
fi

repo_json=''
if ! repo_json=$(gh repo view --json nameWithOwner,defaultBranchRef 2>&1); then
    fail "$(printf 'unable to determine the GitHub repository:\n%s' "$repo_json")"
fi
repo=$(jq -r '.nameWithOwner // empty' <<<"$repo_json")
default_branch=$(jq -r '.defaultBranchRef.name // empty' <<<"$repo_json")
if [[ -z "$repo" ]] || [[ -z "$default_branch" ]]; then
    fail "unable to determine the GitHub repository and default branch"
fi

stack_check=''
if ! stack_check=$(gh api "repos/$repo/stacks?per_page=1" --silent 2>&1); then
    if [[ "$stack_check" == *"HTTP 404"* ]]; then
        fail "GitHub Stacked PRs are not enabled for this repository; use 'git cr' instead"
    else
        fail "$(printf 'unable to verify GitHub Stacked PRs availability:\n%s' "$stack_check")"
    fi
fi

remote_refs=''
if ! remote_refs=$(gh api "repos/$repo/git/matching-refs/heads/$branch" 2>&1); then
    fail "$(printf 'unable to check whether the remote branch exists:\n%s' "$remote_refs")"
fi
if jq -e --arg ref "refs/heads/$branch" '.[] | select(.ref == $ref)' <<<"$remote_refs" >/dev/null; then
    fail "remote branch already exists: $branch"
fi

clean_terminal() {
    # Remove PTY framing, terminal queries, colors, links, and cursor controls.
    perl -pe 's/\^D\x08\x08//g; s/\r//g; s/\e\][^\a\e]*(?:\a|\e\\)//g; s/\e\[[0-?]*[ -\/]*[\@-~]//g; s/\x08//g'
}

success() {
    if color_enabled 1; then
        printf '\033[32m✓\033[0m %s\n' "$*"
    else
        printf '✓ %s\n' "$*"
    fi
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
    local output exit_code cleaned_err

    if output=$(run_pty_capture "$@" 2>&1); then
        return 0
    else
        exit_code=$?
    fi

    cleaned_err=$(printf '%s' "$output" | clean_terminal | sed '/^[[:space:]]*$/d')
    [[ -n "$cleaned_err" ]] || cleaned_err="command failed: $*"
    print_error "$cleaned_err"
    return "$exit_code"
}

render_submit_output() {
    local line
    while IFS= read -r line; do
        case "$line" in
            ''|'Checking stack state...'|'Pushing to origin...'|\
            '✓ Created PR '*|'✓ Pushed and synced '*|'✓ Stack created on GitHub '*|\
            'PR '*' is up to date')
                continue
                ;;
        esac
        if [[ "$line" == '✓ '* ]]; then
            success "${line#'✓ '}"
        else
            printf '%s\n' "$line"
        fi
    done
}

run_submit() {
    local output exit_code cleaned

    if output=$(run_pty_capture gh stack submit --auto --open 2>&1); then
        exit_code=0
    else
        exit_code=$?
    fi

    cleaned=$(printf '%s' "$output" | clean_terminal)
    if [[ $exit_code -ne 0 ]]; then
        cleaned=$(printf '%s' "$cleaned" | sed '/^[[:space:]]*$/d')
        [[ -n "$cleaned" ]] || cleaned='gh stack submit failed'
        print_error "$cleaned"
        return "$exit_code"
    fi

    printf '%s\n' "$cleaned" | render_submit_output
}

has_changes() {
    [[ -n "$(git status --porcelain)" ]]
}

verify_submission() {
    local pr_url post_stack branch_count remote_pages remote_stacks attempt

    if ! pr_url=$(gh pr view "$branch" --json url --jq .url 2>/dev/null) || [[ -z "$pr_url" ]]; then
        print_error "gh stack submit completed without creating a PR for $branch"
        return 1
    fi

    if ! post_stack=$(gh stack view --json 2>/dev/null); then
        print_error "gh stack submit completed, but the local stack could not be verified"
        return 1
    fi
    if ! branch_count=$(jq '.branches | length' <<<"$post_stack"); then
        print_error "gh stack submit completed, but local stack JSON was invalid"
        return 1
    fi

    if [[ $branch_count -gt 1 ]]; then
        for attempt in 1 2 3; do
            if remote_pages=$(gh api --paginate --slurp "repos/$repo/stacks?per_page=100" 2>/dev/null) \
                && remote_stacks=$(jq 'add // []' <<<"$remote_pages") \
                && jq -e --arg branch "$branch" \
                    '[.[]?.pull_requests[]? | select(.head.ref == $branch)] | length > 0' \
                    <<<"$remote_stacks" >/dev/null; then
                printf '%s\n' "$pr_url"
                return 0
            fi
            [[ $attempt -eq 3 ]] || sleep 1
        done
        print_error "PR created, but GitHub did not add $branch to the remote stack"
        return 1
    fi

    printf '%s\n' "$pr_url"
}

stack_json=$(gh stack view --json 2>/dev/null || true)

if [[ -n "$stack_json" ]] && jq -e '.branches[]? | select(.isCurrent)' <<<"$stack_json" >/dev/null; then
    run_quietly gh stack add "$branch"
else
    if [[ "$current_branch" == "$default_branch" ]]; then
        run_quietly gh stack init "$branch"
    else
        run_quietly gh stack init --base "$default_branch" "$current_branch" "$branch"
    fi
fi

if has_changes; then
    git add -A
    git commit -m "$message"
else
    success "Created empty stack branch $branch (no changes to submit yet)"
    exit 0
fi

run_submit

if pr_url=$(verify_submission); then
    success "Stack submitted successfully: $pr_url"
else
    exit $?
fi
