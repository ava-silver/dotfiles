#!/bin/bash
set -euo pipefail
# usage:
# create.sh ticket-1234 summary of this change, none of this needs to be quoted

# you can also set this as a git alias with:
# git config --global alias.cr '!bash /path/to/create.sh'
# which will allow you to use it like `git cr ticket-1234 summary of change`

ticket=`echo $1 | tr '[:upper:]' '[:lower:]'`
shift
branch="$ticket/$@"
msg="[$(echo $ticket | tr '[:lower:]' '[:upper:]')] $@"

gt create --all "$branch" -m "$msg"
gt ss
