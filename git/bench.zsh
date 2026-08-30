#!/usr/bin/env zsh

# Benchmark the Git operations used by the prompt and interactive shell startup.
# Set GIT_BENCH_REPEAT to change the number of samples (default: 5).

emulate -L zsh
setopt pipefail
zmodload zsh/datetime

integer repeat=${GIT_BENCH_REPEAT:-5}
(( repeat > 0 )) || { print -u2 'GIT_BENCH_REPEAT must be positive'; exit 2; }

if (( $# )); then
  repos=("$@")
else
  repos=("$HOME/dd/web-ui" "$HOME/dd/dd-source")
fi

if ! (( $+commands[script] )); then
  print -u2 'startup benchmark requires the macOS script command'
  exit 2
fi

benchmark_command() {
  local label=$1
  shift
  local -a samples=() statuses=()
  local -F 6 started elapsed

  local -i i
  for (( i = 1; i <= repeat; i++ )); do
    started=$EPOCHREALTIME
    "$@" >/dev/null 2>&1
    statuses+=($?)
    elapsed=$(( (EPOCHREALTIME - started) * 1000 ))
    samples+=($elapsed)
  done

  report_samples "$label" "$samples[@]" "$statuses[@]"
}

benchmark_startup() {
  local label=$1 repo=$2
  local -a samples=() statuses=()
  local -F 6 started elapsed
  local -i i

  for (( i = 1; i <= repeat; i++ )); do
    started=$EPOCHREALTIME
    (
      cd -- "$repo" || exit
      printf 'exit\n' | script -q /dev/null zsh -li
    ) >/dev/null 2>&1
    statuses+=($?)
    elapsed=$(( (EPOCHREALTIME - started) * 1000 ))
    samples+=($elapsed)
  done

  report_samples "$label" "$samples[@]" "$statuses[@]"
}

report_samples() {
  local label=$1
  shift
  local -a samples statuses sorted
  samples=($@[1,$repeat])
  statuses=($@[${repeat}+1,-1])
  sorted=(${(n)samples})

  local -F 3 median
  local middle=$(( (repeat + 1) / 2 ))
  if (( repeat % 2 )); then
    median=$sorted[$middle]
  else
    median=$(( (sorted[$middle] + sorted[$middle + 1]) / 2 ))
  fi

  printf '  %-24s median %8.2f ms  min %8.2f ms  max %8.2f ms  rc %s\n' \
    "$label" "$median" "$sorted[1]" "$sorted[-1]" "${(j:, :)${(u)statuses}}"
}

for repo in "${repos[@]}"; do
  if [[ ! -d $repo ]] || ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    print -u2 "Skipping non-Git repository: $repo"
    continue
  fi

  print "Repository: ${repo/#$HOME/~}"
  print "  format: $(git -C "$repo" rev-parse --show-ref-format 2>/dev/null)"
  benchmark_command 'backend detection' \
    git -C "$repo" config --local --get extensions.refStorage
  benchmark_command 'repository lookup' \
    git -C "$repo" rev-parse --absolute-git-dir --show-toplevel
  benchmark_command 'full Git status' \
    git -C "$repo" status --porcelain=v2 --branch --no-renames
  benchmark_startup 'interactive startup' "$repo"
  print
done
