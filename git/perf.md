# Git prompt performance

## Two prompt paths

The p10k git segment routes per repo:

- **Non-reftable** (`repositoryformatversion=0`) → gitstatus/libgit2. Fast, async, C. Covers GitHub, GitLab, personal repos -- the majority.
- **Reftable** (`repositoryformatversion=1`) → gitcli (`_p9k_prompt_gitcli_async` in `shell/p10k.zsh`). Pure `git` subprocess calls. Covers newer Datadog repos that were initialized with `--ref-format=reftable`.

## What was optimized

The gitcli path previously made ~9 git subprocess calls per prompt. Reduced to 3:

1. `git rev-parse --absolute-git-dir --show-toplevel` -- verifies git repo, captures git dir and worktree root
2. `git config --local core.repositoryformatversion` -- determines which path to take
3. `git status --porcelain=v2 --branch --no-renames` -- branch name, ahead/behind, and dirty status in one call (the `--branch` flag adds `# branch.*` header lines)

Action detection (merge/rebase/cherry-pick) now reads the git dir directly instead of spawning a subprocess. `git status` is wrapped in `timeout 10` (GNU coreutils) so a hung index scan degrades to a loading indicator rather than a frozen prompt.

Detached HEAD adds one more call (`git describe --tags`) but uses the `# branch.oid` SHA already in memory as fallback, so no extra `rev-parse --short` needed.

## Gitconfig guards

Three global settings protect gitstatus/libgit2 on non-reftable repos -- libgit2 can't parse the FSMN/UNTR index extensions that fsmonitor and untrackedCache write:

```
core.fsmonitor = false
core.untrackedCache = false
index.skipHash = false   # feature.manyFiles implies skipHash=true
```

These don't apply to reftable repos since they never touch libgit2.

## To do on the work laptop

**Check which repos are reftable:**
```sh
git -C ~/dd/some-repo rev-parse --show-toplevel && git config core.repositoryformatversion
# 1 = reftable (gitcli path), 0 = non-reftable (gitstatus path)
```

**Enable fast status on reftable repos** (safe -- gitcli path, no libgit2):
```sh
git setup-reftable-perf
# sets core.fsmonitor=true + core.untrackedCache=true locally
```

Do this in each large reftable repo. First `git status` after enabling populates the caches; every subsequent call (including each prompt) uses OS-level change detection instead of a full tree walk.

**Check if any non-reftable repos have locally-set overrides** that could still break gitstatus:
```sh
git config --local core.fsmonitor
git config --local core.untrackedCache
git config --local index.skipHash
git config --local feature.manyFiles
# Any of these being true/1 on a non-reftable repo will cause stale prompt status
```
