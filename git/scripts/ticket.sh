#!/bin/bash
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ $branch =~ .*/.*/.* ]]; then 
    echo "$(echo $branch | cut -d '/' -f 2 | tr '[:lower:]' '[:upper:]')" 
fi