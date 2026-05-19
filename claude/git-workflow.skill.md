---
name: git-workflow
description: Ava's git/Graphite (gt) workflow at Datadog. Load BEFORE any git, gt, or gh pr command — including git commit, git push, git ac, git cr, gt ss, gt s, gt submit, creating branches, opening PRs, syncing, worktrees, or editing PR descriptions. Contains required aliases (git cr, git ac, gt ss --no-edit -q), branch naming (ava.silver/TICKET/desc), and the rule to never use git push.
user_invocable: false
---

# Git Workflow

All repos use **Graphite (`gt`)** for stacked PRs. Most git operations should go through custom aliases that auto-format branches and commit messages.

## Branch naming
Branches follow: `ava.silver/{TICKET}/{short-description}`
- Ticket is lowercase: `ava.silver/svls-1234/fix-timeout`
- Chore/no-ticket work: `ava.silver/chore/{description}`
- Graphite sets the `ava.silver/` prefix automatically

## Starting work (branch + PR in one shot)
```bash
git cr svls-1234 short description here
```
- Stages ALL uncommitted changes, creates the branch, commits, and opens a PR
- Also works when you need to create a new branch first -- just run `git cr ...` directly, it handles branch creation
- Message becomes: `[SVLS-1234] short description here`
- Chore: `git cr chore short description` → branch `ava.silver/chore/short-description`, message `chore: short description`

**Already on a branch (e.g. in a worktree)?** If the changes are already on a named branch with no commits yet (worktrees are typically set up this way), skip `git cr` -- just commit and push normally:
```bash
git ac short description here
gt ss --no-edit -q
```
Then fill out the PR description as described below.

## Adding commits
```bash
git ac short description here
```
- Stages all + commits. Does NOT push.
- `commit.sh` auto-prepends the ticket from the branch name: `[SVLS-1234] short description`
- To push after: `gt ss --no-edit -q`

## Pushing / submitting PRs
```bash
gt ss --no-edit -q   # submit full stack, no interactive prompts, minimal/no ouput 
```
- **Never use `git push`** -- always use `gt ss` so Graphite manages the stack and PRs correctly
- `gt ss` = `gt submit --stack` -- pushes all branches in the stack (ancestors + descendants), creating/updating PRs for each
- Uses `--force-with-lease` by default (safe to run repeatedly)
- `--no-edit -q` skips interactive PR metadata prompts and minimizes output

## Creating PRs
After creating a PR (via `git cr` or `gt ss`), update the PR description with `gh pr edit --body`. Check the repo's PR template (`.github/PULL_REQUEST_TEMPLATE.md` or similar) and fill it in. You should have enough context from the work done so far; if not, check the branch diff or the Jira ticket (if one was provided) for additional context.

**Passing the body:** Use a `<<'EOF'` heredoc (single-quoted delimiter -- everything inside is literal, no escaping needed). Do NOT escape backticks with `\`` inside a single-quoted heredoc; they are already literal and the backslashes will appear verbatim in the PR body.

### QA Links

When making PRs for the UI, always include clickable staging links in the QA Instructions section. Compute the hash from the branch name (same for all commits on the branch -- no network call needed):

```bash
HASH=$(git branch --show-current | tr -d '\n' | md5sum | awk '{print $1}')
```

**Serverless PRs** -- use judgement from the diff to classify:
- **Serverless-only** (all changes are within the serverless product scope):
  → `https://ddserverless-${HASH}.datadoghq.com/<inferred-path>`
- **Cross-team** (serverless changes that also touch shared or non-serverless code):
  → Both `https://ddserverless-${HASH}.datadoghq.com/<inferred-path>`
    and `https://app-${HASH}.datadoghq.com/<inferred-path>`
- If it's ambiguous whether a PR is serverless-only or cross-team, ask.

Infer the path from the changed file paths (eg: `/serverless/aws/lambda?config_your-feature-flag=true`, `/serverless/settings`, `/integrations/amazon-web-services`, etc). Feature flags are set by the ?config_feature-flag-name=value URL param.

## Syncing
```bash
gt s    # sync branch from origin, never overwrites local changes
```
Prefer over `git pull` directly.

## Worktrees
Worktrees live at `~/dd/{repo-name}.worktrees/{branch-name}/` (slashes in branch names replaced with `-`).

To create one manually:
```bash
git worktree add ~/dd/{repo}.worktrees/{branch} {branch}
git checkout $(git main)
```
Note: the `wt` shell function does this + `cd`s into the worktree, but it's a shell function not available to Claude. Use the above directly.

## Key rules
- Prefer `gt` commands for everything except `git cr` and `git ac`
- Prefer `git ac` over `git commit` directly, but manual `git commit` is fine — if used, run `gt track` afterwards so Graphite can manage the branch
- **Never use `git push`** -- always use `gt ss --no-edit -q` to push and submit PRs
- Prefer `gt s` over `git pull`
- Do not add Claude as a co-author to any commit
