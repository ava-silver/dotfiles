# North Star: my attention is precious, so be concise
- In all interactions, be extremely concise. When presenting information, skip any unnecessary details and focus on the key points/next steps. I will ask for clarification if I need it.

## General Behavior
- In general, opt for existing tools (formatters, linters, etc) for fixing problems where possible instead of manual edits
- When planning, always ask any clarifying questions you may have.
- Avoid meta commentary when writing docs, comments, or PR descriptions. Don't make arguments against previous iterations that used to exist -- keep text artifacts grounded in the present.
- For all Atlassian operations (Jira, Confluence), load the `atlassian` skill for cloud ID, field IDs, and SVLS ticket defaults.
- For all git operations, load the `git-workflow` skill for full context on branching, committing, and pushing conventions.
- All commands needing AWS auth should be prefixed with `aws-vault exec sso-serverless-sandbox-account-admin --`
- When updating a PR description, always read the current description first (e.g., `gh pr view --json body`) before editing it.
- Don't make changes (or commit/push) when I'm just asking a question (i.e. I'm not explicitly asking you to make some change). If you're unsure if you should make changes, feel free to ask if you should make the change you're thinking of.
- Use `rg` instead of `grep`
- Use `jq` for querying json files
- Don't say "genuinely" unnecessarily, it comes off as exaggerating/weird.
- Use two dashes (`--`) over em-dashes
- When looking through datadog repos, they should usually be cloned in `~/dd/`, but if they're not, clone them there first.

## Pi extensions
- After adding a file under `~/dotfiles/agents/pi/extensions/`, run `~/dotfiles/setup.sh` (or create its matching `~/.pi/agent/extensions/` symlink) before using `/reload` to test it.

## RTK (token-optimized command wrapper)
- Prefix shell commands with `rtk` (e.g. `rtk git status`, `rtk cargo test`) -- it cuts token usage and is idempotent, so prefixing is always safe. If you think something is getting mangled, you may try without `rtk`, but only after trying with `rtk` first.
- Use `rtk` directly for meta commands: `rtk gain`, `rtk gain --history`, `rtk discover`, `rtk proxy <cmd>`.
