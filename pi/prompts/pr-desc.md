---
description: Update the current PR description using a writing-focused subagent
argument-hint: "[additional instructions]"
---
Call `subagent_spawn` exactly once with:

- `harness`: `pi`
- `model`: `anthropic/claude-sonnet-5`
- `name`: `write PR description`
- omit `working_dir` so it uses the current repository
- `prompt`:

  Update the current branch's PR description. Read and follow
  `~/.agents/skills/pr-description/SKILL.md`, including any referenced skills.
  Perform the update yourself using `gh`. Do not ask questions; if blocked,
  report the blocker. Additional instructions: $@

Wait for the subagent and report its result. Do not write or edit the PR
description yourself.
