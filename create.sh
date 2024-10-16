#!/bin/bash
set -euo pipefail
# usage:
# create.sh ticket-1234 summary of this change, none of this needs to be quoted

# you can also set this as a git alias with:
# git config --global alias.c '!bash /path/to/commit.sh'
# which will allow you to use it like `git c summary of change`

ticket=`echo $1 | tr '[:lower:]' '[:upper:]'`
shift
branch="$ticket/$@"
msg="[$ticket] $@"

gt create --all "$branch" -m "$msg"
