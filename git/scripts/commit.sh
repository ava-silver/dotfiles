#!/bin/bash

# usage:
# commit.sh summary of this change, none of this needs to be quoted
# OR
# commit.sh
# and you will be prompted for the summary of this change (using `gum`)

# NOTE: This assumes your branch is in the format your-name/ticket-123/some-description
# If this is not the case, no ticket number will be prepended to the commit message

# you can also set this as a git alias with:
# git config --global alias.c '!bash /path/to/commit.sh'
# which will allow you to use it like `git c summary of change`
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

if [ $# -eq 0 ]; then
    msg=$(gum input --placeholder 'Summary of this change')
else
    msg="$*"
fi
ticket=$("$SCRIPT_DIR/ticket.sh")
if [ -n "$ticket" ]; then
    ticket="[$ticket] "
fi

if "$SCRIPT_DIR/is-graphite.sh"; then
    gt cm -m "$ticket$msg"
else
    git commit -m "$ticket$msg"
fi
