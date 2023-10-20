#!/bin/bash

if [ $# -eq 0 ]; then
    msg=`gum input --placeholder 'Summary of this change'`
else
    msg="$@"
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
ticket=`$HOME/.dotfiles/ticket.sh`
if [ ! -z "$ticket" ]; then
    ticket="[$ticket] "
fi
git commit -m "$ticket$msg"
