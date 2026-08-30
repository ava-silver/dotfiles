# Git prompt performance investigation

## Measured repositories

Measurements use Git 2.50.1 on macOS with warm filesystem caches.

| Repository | Git format | Tracked files | Index | `status` | `status -uno` |
| --- | --- | ---: | ---: | ---: | ---: |
| `~/dd/dd-source` | files | 395,735 | 59 MiB | 7.6 s | 58 ms |
| `~/dd/web-ui` | reftable | 236,596 | 21 MiB | 5.1 s before caches, 175 ms after | 57 ms |

Trace2 attributes the delay to the untracked-file scan. It visited 56,009 directories and 301,938 paths in `web-ui`, and 86,266 directories and 481,962 paths in `dd-source`.

`web-ui` now has the recommended local settings:

```ini
core.fsmonitor = true
core.untrackedCache = true
feature.manyFiles = true
extensions.refStorage = reftable
```

The first status call populates the index cache. Later calls avoid the full directory walk. `dd-source` includes a later `.git-shared-config` that overrides its earlier local `core.fsmonitor=false`, so inspect effective values with `git config --get`, not only `--local`.

## Findings

- `vcs` and `gitcli` are separate prompt segments, so both used to run. The prompt now selects one backend before rendering: files repositories use `gitstatus`, and reftable repositories use the Git CLI.
- `core.repositoryformatversion=1` means that a repository uses extensions; it does not prove that the repository uses reftable. The prompt now checks `extensions.refStorage=reftable`, and `setup-reftable-perf` rejects other repositories.
- Disabling `core.fsmonitor` and `core.untrackedCache` does not remove extensions already written to an index. `dd-source` now has effective fsmonitor disabled and no `FSMN` or `UNTR` index extensions, so it is safe to use with `gitstatus`.
- A failed or timed-out CLI status must not become a clean status. The prompt now publishes `loading` when status exits unsuccessfully, and it clears the loading state outside Git repositories.
- Ahead/behind counts are included in `status --branch`. In `web-ui`, `--no-ahead-behind` made no measurable difference at about 165 ms, so untracked-file discovery is the current bottleneck.

## Current state

- `dd-source` has been repaired for `gitstatus`: effective fsmonitor is `false`, and its index no longer contains `FSMN` or `UNTR`.
- `web-ui` has local fsmonitor and untracked-cache support enabled for its reftable index.
- The prompt now selects one status backend per repository while retaining untracked detection and counts.

## Repeatable benchmark

Use `git/bench.zsh` to measure the prompt's Git operations and interactive shell startup:

```sh
GIT_BENCH_REPEAT=5 ./git/bench.zsh ~/dd/web-ui ~/dd/dd-source
```

The harness reports median, minimum, and maximum times for:

- backend detection with `git config`
- repository lookup with `git rev-parse`
- full status with `git status --porcelain=v2 --branch --no-renames`
- interactive startup through the macOS `script` command

The status benchmark always includes untracked-file detection. The backend check returns status 1 when `extensions.refStorage` is unset, which is expected for files-backed repositories.

Use Trace2 when a status call exceeds the expected cost:

```sh
GIT_TRACE2_PERF=/tmp/git-status.perf \
  git -C ~/dd/dd-source status --porcelain=v2 --branch --no-renames
```

## Detection and safety checks

```sh
for repo in ~/dd/dd-source ~/dd/web-ui; do
  printf '%s: ' "$repo"
  git -C "$repo" rev-parse --show-ref-format
  git -C "$repo" config --show-origin --get-regexp \
    '^(core\.(repositoryformatversion|fsmonitor|untrackedCache)|index\.skipHash|feature\.manyFiles|extensions\.refStorage)$' || true
done
```
