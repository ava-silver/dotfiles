---
name: git-workflow
description: Ava's git/Graphite workflow. Use this skill for context whenever doing any git operation — committing, branching, pushing, PRs, syncing.
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

## Adding commits
```bash
git ac short description here
```
- Stages all + commits. Does NOT push.
- `commit.sh` auto-prepends the ticket from the branch name: `[SVLS-1234] short description`
- To push after: `gt ss`

## Pushing / submitting PRs
```bash
gt ss   # submit stack — always force-pushes, safe to run repeatedly
```
Prefer over `git push` / `git pu` when working in a Graphite stack.

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
- Prefer `gt ss` over `git push`, and `gt s` over `git pull`
- Do not add Claude as a co-author to any commit
