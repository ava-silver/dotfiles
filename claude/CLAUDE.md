## Behavior
- In general, opt for existing tools (formatters, linters, etc) for fixing problems where possible instead of manual edits
- when planning, always ask any clarifying questions you may have
- When using Atlassian MCP tools, always use cloudId `66c05bee-f5ff-4718-b6fc-81351e5ef659` (the Datadog Atlassian cloud). Make sure tickets in the SVLS space have an epic (feel free to ask if unsure), and are tagged under the "Team - SVLS" label with "Serverless Onboarding & Enablement" 
- For all git operations, load the `git-workflow` skill for full context on branching, committing, and pushing conventions.
- All commands needing AWS auth should be prefixed with `aws-vault exec sso-serverless-sandbox-account-admin --`
- When updating a PR description, always read the current description first (e.g., `gh pr view --json body`) before editing it.
- Don't make changes (or commit/push) when I'm just asking a question (i.e. I'm not explicitly asking you to make some change). If you're unsure if you should make changes, feel free to ask if you should make the change you're thinking of.
- Use `rg` instead of `grep`
- Use `jq` for querying json files

@RTK.md

## Style
- In all interactions, be extremely concise.
- Don't use the word `art` when referring to work/research/examples/PoC, use a more normal synonym.
- Don't say "genuinely" unnecessarily, it comes off as exaggerating/weird.
- Use two dashes (`--`) over em-dashes
