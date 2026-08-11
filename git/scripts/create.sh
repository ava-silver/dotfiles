#!/bin/bash
set -euo pipefail
# usage:
# create.sh ticket-1234 summary of this change, none of this needs to be quoted

# you can also set this as a git alias with:
# git config --global alias.cr '!/path/to/create.sh'
# which will allow you to use it like `git cr ticket-1234 summary of change`

ticket=""
msg="$*"
if [ "$#" -ge 2 ]; then
    ticket=$(basename "$1" | tr '[:upper:]' '[:lower:]')
    shift
    if [[ "$ticket" = "chore" ]]; then
        msg="chore: $*"
    else
        msg="[$(tr '[:lower:]' '[:upper:]' <<<"$ticket")] $*"
    fi
fi

slug=$(printf '%s' "$*" \
    | LC_ALL=C tr '[:upper:]' '[:lower:]' \
    | LC_ALL=C sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
[[ -n "$slug" ]] || {
  echo "description must produce a non-empty branch name"
  exit 1
}

branch="$USER/$slug"
if [ -n $ticket ]; then
    branch="$USER/$ticket/$slug"
fi

if [[ -z "$(git status --porcelain)" ]]; then
    echo "Created empty branch $branch -- nothing to submit"
    exit
fi
git add -A
git commit -m "$msg"

base_branch="$(git rev-parse --abbrev-ref HEAD)"
# commit succeeded -- move it to a new branch
git stk new "$branch"                # new branch pointing at the commit
git switch "$base_branch"
git reset --hard HEAD~1              # rewind base_branch back to before the commit
git switch "$branch"                 # move to the new branch (has the commit)

git ss
