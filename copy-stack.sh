#!/usr/bin/env bash
# Copy the current Graphite stack's open PRs to the clipboard as markdown links.
set -euo pipefail

branches=$(gt ls -s --reverse 2>/dev/null \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | rg '^\s*[◯◉⏺●○]' \
    | sed 's/^[^a-zA-Z0-9_./-]*//' \
    | awk '{print $1}')

out=""
while IFS= read -r b; do
    [[ -z "$b" ]] && continue
    json=$(gh pr view "$b" --json state,title,url 2>/dev/null) || continue
    [[ "$(jq -r '.state' <<<"$json")" != "OPEN" ]] && continue
    title=$(jq -r '.title' <<<"$json")
    url=$(jq -r '.url' <<<"$json")
    out+="- [${title}](${url}/s)"$'\n'
done <<<"$branches"

if [[ -z "$out" ]]; then
    echo "No open PRs found in the current stack." >&2
    exit 1
fi

printf '%s' "$out" | pbcopy
printf '%s' "$out"
echo "(copied to clipboard)" >&2
