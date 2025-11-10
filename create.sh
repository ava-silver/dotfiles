#!/bin/bash
set -euo pipefail
# usage:
# create.sh ticket-1234 summary of this change, none of this needs to be quoted

# you can also set this as a git alias with:
# git config --global alias.cr '!/path/to/create.sh'
# which will allow you to use it like `git cr ticket-1234 summary of change`

if [ "$#" -lt 2 ]; then
    gt create --all -m "$*"
else
    ticket=$1
    shift
    branch=$(echo "$ticket/$*" | tr '[:upper:]' '[:lower:]')
    msg="[$(echo "$ticket" | tr '[:lower:]' '[:upper:]')] $*"
    gt create --all "$branch" -m "$msg"
fi

gt ss
