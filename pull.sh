#!/bin/bash

while ! git pull; do
    echo "Git pull failed. Checking for locked references..."

    LOCKED_REFS=$(git pull 2>&1 | grep -o "cannot lock ref '[^']*': '[^']*' exists" | awk -F "': '" '{print $2}' | awk -F "' exists" '{print $1}')

    if [ -n "$LOCKED_REFS" ]; then
        for LOCKED_REF in $LOCKED_REFS; do
            echo "Locked reference found: $LOCKED_REF"
            git update-ref -d "$LOCKED_REF"
        done

        echo "Retrying git pull..."
    else
        break
    fi
done