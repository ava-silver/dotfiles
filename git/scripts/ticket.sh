#!/bin/bash
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ $branch =~ .*/.*/.* ]]; then
    ticket="$(echo $branch | cut -d '/' -f 2 | tr '[:lower:]' '[:upper:]')"
    [[ "$ticket" != "CHORE" ]] && echo $ticket || true
fi
