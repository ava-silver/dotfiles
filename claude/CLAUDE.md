## Behavior
- In general, opt for existing tools (formatters, linters, etc) for fixing problems where possible instead of manual edits
- When planning, always ask any clarifying questions you may have.
- Avoid meta commentary when writing docs, comments, or PR descriptions. Don't make arguments against previous iterations that used to exist -- keep text artifacts grounded in the present.
- For all Atlassian operations (Jira, Confluence), load the `atlassian` skill for cloud ID, field IDs, and SVLS ticket defaults.
- For all git operations, load the `git-workflow` skill for full context on branching, committing, and pushing conventions.
- All commands needing AWS auth should be prefixed with `aws-vault exec sso-serverless-sandbox-account-admin --`
- When updating a PR description, always read the current description first (e.g., `gh pr view --json body`) before editing it.
- When writing PR descriptions with `gh pr edit --body`, pass the body as a plain shell string (not a heredoc) to avoid over-escaping backticks. Backticks inside the string should be escaped with `\`` but nothing else should be double-escaped.
- Don't make changes (or commit/push) when I'm just asking a question (i.e. I'm not explicitly asking you to make some change). If you're unsure if you should make changes, feel free to ask if you should make the change you're thinking of.
- Use `rg` instead of `grep`
- Use `jq` for querying json files

@RTK.md

## Style
- In all interactions, be extremely concise.
- Don't use the word `art` when referring to work/research/examples/PoC, use a more normal synonym.
- Don't say "genuinely" unnecessarily, it comes off as exaggerating/weird.
- Use two dashes (`--`) over em-dashes
