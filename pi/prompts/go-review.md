---
description: Review a GitHub PR with general and Marketplace Go reviewers
argument-hint: "<PR URL> [focus]"
---
Review PR `$1` using two independent Sol subagents, then consolidate a draft for my approval. Optional focus: `${@:2}`.

Require `$1` to be a full GitHub pull request URL. If it is missing or invalid, ask for it and stop.

Before any `git` or `gh` command, read `~/skills/skills/git-workflow/SKILL.md`. Also read:
- `~/skills/skills/code-review/SKILL.md`
- `~/skills/skills/subagents/SKILL.md`

Resolve the active Claude Marketplace Go reviewer from `~/.claude/plugins/installed_plugins.json` with:
```sh
jq -r '.plugins["go-code-reviewer@datadog-claude-plugins"][] | select(.scope == "user") | .installPath' ~/.claude/plugins/installed_plugins.json
```
Read its `skills/go-review/SKILL.md` and all of these live rubrics:
- `agents/go-naming-reviewer.md`
- `agents/go-errors-reviewer.md`
- `agents/go-testing-reviewer.md`
- `agents/go-concurrency-reviewer.md`
- `agents/go-performance-reviewer.md`
- `agents/go-structure-reviewer.md`
- `agents/go-style-reviewer.md`

If the plugin or any required file is unavailable, report the missing path and stop. Do not copy or modify Marketplace content.

Launch exactly two independent `openai-codex/gpt-5.6-sol` subagents with high reasoning effort in parallel. Both are read-only and must not change files, commit, push, or post to GitHub.

1. **General reviewer**: Follow `code-review` for this PR. Inspect the PR diff, surrounding code, call sites, tests, relevant specs, and repository guidance. Report only actionable findings with severity, PR-head `file:line`, evidence, impact, and concise fix direction.
2. **Go reviewer**: Review the same PR using the live Marketplace `go-review` skill and all seven specialist rubrics. Cover Go correctness, APIs, errors, concurrency, tests, structure, naming, performance, and style. Do not report `gofmt` or other automatic-formatting nits. Return only actionable findings with severity, PR-head `file:line`, evidence, impact, and concise fix direction.

Consolidate their reports yourself:
- Merge duplicate findings, retaining the strongest evidence.
- Label meaningful uncertainty or reviewer disagreement.
- Do not invent findings.
- Present numbered findings grouped by severity, with source tags: `general`, `go`, or `both`.
- Include explicit zero-finding sections where applicable.

Then stop. Ask me to bulk-select findings to include, for example `1, 3-5`, or `none`. Do not post anything yet.

After I select findings, show the exact proposed inline comments and a one- or two-sentence review summary. Ask for explicit confirmation. Only after I confirm, offer to post the selected comments. Default to a `COMMENT` review, but let me choose `REQUEST_CHANGES` or `APPROVE`.

For posting, read `~/skills/skills/post-review/SKILL.md` and follow it exactly. Never post findings that I did not select.
