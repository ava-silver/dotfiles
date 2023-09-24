#!/bin/bash

if [ $# -eq 0 ]; then
    msg=`gum input --placeholder 'Summary of this change'`
else
    msg="$@"
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ $branch =~ ava.silver/.*/.* ]]; then 
    ticket="[$(echo $branch | cut -d '/' -f 2 | tr '[:lower:]' '[:upper:]')] " 
else 
    ticket='' 
fi
git commit -m "$ticket$msg"