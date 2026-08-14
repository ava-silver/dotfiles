# North Star: my attention is precious, so be concise

- In all interactions, be extremely concise. When presenting information, skip any unnecessary details and focus on the key points/next steps. I will ask for clarification if I need it.

## General Behavior

- Start with the simplest implementation that satisfies the stated requirements and existing tests. Before adding an abstraction, guard, or edge-case handling, name (to yourself) the concrete requirement, failing test, observed failure, or established repository convention it addresses -- with file:line if it's a type or call site. If you cannot, leave it out. When the answer is a lookup question (can this be null? who are the callers? does this already exist in the repo?), go look it up rather than hedging.
- Treat Jira tickets as work-tracking context, not an exhaustive specification. Do not remove or label diff behavior speculative merely because it is absent from the ticket; use the diff, surrounding code, tests, and user direction to establish intent. Ask before removing behavior when intent remains unclear.
- In general, opt for existing tools (formatters, linters, etc) for fixing problems where possible instead of manual edits
- After implementation, reread the complete diff and remove speculative abstractions, checks, and indirection.
- Avoid meta commentary when writing docs, comments, or PR descriptions. Don't make arguments against previous iterations that used to exist -- keep text artifacts grounded in the present.
- For all git operations, load the `git-workflow` skill for full context on branching, committing, and pushing conventions.
- Use the current worktree unless the user specifically requests a different one.
- When updating a PR description, always read the current description first (e.g., `gh pr view --json body`) before editing it.
- Don't make changes (or commit/push) when I'm just asking a question (i.e. I'm not explicitly asking you to make some change). If you're unsure if you should make changes, feel free to ask if you should make the change you're thinking of.
- Use two dashes (`--`) over em-dashes
- When looking through datadog repos, they should usually be cloned in `~/dd/`, but if they're not, clone them there first.

## Tools

- Run commands needing AWS auth through `aws-sso-exec` (for example, `aws-sso-exec aws sts get-caller-identity`). It uses native AWS SSO and opens a browser for the user to auth only when required.
- Use Colima instead of Docker.
- Use the `ffgrep` tool or `rg` instead of `grep`
- Use `jq` for querying json files
- Use `mq` for querying large markdown files

## Pi config

- Pi loads extensions/themes/etc from `~/dotfiles/pi/` directly; use `/reload` after adding or changing an extension.
- All skills live in `~/skills/skills/` (also loads `~/dd/claude-marketplace/serverless/skills`)

## RTK (token-optimized command wrapper)

- Prefix shell commands with `rtk` (e.g. `rtk git status`, `rtk cargo test`) -- it cuts token usage and is idempotent, so prefixing is always safe. If you think something is getting mangled, you may try without `rtk`, but only after trying with `rtk` first.
- Use `rtk` directly for meta commands: `rtk gain`, `rtk gain --history`, `rtk discover`, `rtk proxy <cmd>`.
