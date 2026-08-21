#!/bin/bash

while true; do
    PULL_OUTPUT=$(git pull 2>&1 | tee /dev/tty)
    if [[ "${PIPESTATUS[0]}" == "0" ]]; then
        break
    fi

    echo "Git pull failed. Checking for locked references..."

    LOCKED_REFS=$(echo "$PULL_OUTPUT" | grep -o "cannot lock ref '[^']*'" | cut -d"'" -f2)

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
