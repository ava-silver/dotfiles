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

- `vcs` and `gitcli` are separate prompt segments, not backend alternatives. Both are scheduled on every prompt. A normal repository still pays for the `gitcli` repository checks while `gitstatus` handles the status. A reftable repository still attempts `gitstatus` before the CLI fallback runs.
- `core.repositoryformatversion=1` means that a repository uses extensions; it does not prove that the repository uses reftable. The prompt now checks `extensions.refStorage=reftable`, and `setup-reftable-perf` rejects other repositories.
- Disabling `core.fsmonitor` and `core.untrackedCache` does not remove extensions already written to an index. `dd-source` still contains an `FSMN` index extension despite its false local settings, so `gitstatus` may fail or report stale data.
- A failed or timed-out CLI status must not become a clean status. The prompt now publishes `loading` when status exits unsuccessfully, and it clears the loading state outside Git repositories.
- Ahead/behind counts are included in `status --branch`. In `web-ui`, `--no-ahead-behind` made no measurable difference at about 165 ms, so untracked-file discovery is the current bottleneck.

## Recommended next steps

1. Repair the existing non-reftable index before relying on `gitstatus`:

   ```sh
   repo=~/dd/dd-source
   git -C "$repo" config --file "$repo/.git-shared-config" core.fsmonitor false
   git -C "$repo" config --local core.fsmonitor false
   git -C "$repo" config --local core.untrackedCache false
   git -C "$repo" config --local feature.manyFiles false
   git -C "$repo" config --local index.skipHash false
   git -C "$repo" update-index --no-fsmonitor --no-untracked-cache
   ```

   Confirm that `git -C "$repo" config --get core.fsmonitor` is `false` and that the index no longer contains `FSMN` or `UNTR`, then restart the shell.

2. Stop scheduling both prompt backends. Select the backend before running status, or enable the CLI segment only for known reftable repositories. This is the largest remaining prompt-level inefficiency.

3. Keep `core.fsmonitor` and `core.untrackedCache` enabled in large reftable repositories. Run:

   ```sh
   git -C ~/dd/web-ui setup-reftable-perf
   ```

4. Re-run the measurements after repairing `dd-source` and after changing backend selection. Use Trace2 when a status call exceeds the expected cost:

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
