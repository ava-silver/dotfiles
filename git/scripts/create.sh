#!/bin/bash
set -euo pipefail
# usage:
# create.sh ticket-1234 summary of this change, none of this needs to be quoted

# you can also set this as a git alias with:
# git config --global alias.cr '!/path/to/create.sh'
# which will allow you to use it like `git cr ticket-1234 summary of change`
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

if ! $SCRIPT_DIR/is-graphite.sh; then
    slug=$(printf '%s' "$*" \
        | LC_ALL=C tr '[:upper:]' '[:lower:]' \
        | LC_ALL=C sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
    [[ -n "$slug" ]] || {
      echo "description must produce a non-empty branch name"
      exit 1
    }
    git switch -c "$USER/$slug"
    git add -A
    git commit -m "$*"
    git push -u origin HEAD
    gh pr create --fill-first
    exit
fi

if [ "$#" -lt 2 ]; then
    gt create --all -m "$*"
else
    ticket=$(basename "$1")
    shift
    branch=$(echo "$ticket/$*" | tr '[:upper:]' '[:lower:]')
    if [[ "$(tr '[:upper:]' '[:lower:]'<<<"$ticket")" = "chore" ]]; then
        msg="chore: $*"
    else
        msg="[$(echo "$ticket" | tr '[:lower:]' '[:upper:]')] $*"
    fi
    gt create --all "$branch" -m "$msg"
fi

gt ss
