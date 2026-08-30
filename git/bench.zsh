#!/usr/bin/env zsh

# Benchmark the Git operations and collector used by the prompt.
# Usage: GIT_BENCH_REPEAT=5 ./git/bench.zsh [repository ...]
# Status uses Git's normal untracked-file detection; no -uno shortcut is used.
# Set GIT_BENCH_REPEAT to change the number of samples (default: 5).

emulate -L zsh
setopt pipefail
zmodload zsh/datetime

integer repeat=${GIT_BENCH_REPEAT:-5}
(( repeat > 0 )) || { print -u2 'GIT_BENCH_REPEAT must be positive'; exit 2; }

readonly p10k_config=${0:A:h:h}/shell/p10k.zsh

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

collect_prompt_status() {
  local repo=$1 git_dir=$2 toplevel=$3 output
  output=$(zsh -dfc '
    source "$1"
    _p9k_prompt_gitcli_async 1 "${2:A}" "$3" "$4"
  ' git-bench "$p10k_config" "$repo" "$git_dir" "$toplevel")
  [[ $output == '_git_prompt_apply '* && $output != *' loading loading' ]]
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

for input_repo in "${repos[@]}"; do
  local -a paths=("$input_repo")
  local resolved=${input_repo:A}
  [[ $resolved == $input_repo ]] || paths+=("$resolved")

  for repo in "${paths[@]}"; do
    if [[ ! -d $repo ]] || ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
      print -u2 "Skipping non-Git repository: $repo"
      continue
    fi

    local -a discovery=("${(@f)$(git -C "$repo" rev-parse --absolute-git-dir --show-toplevel 2>/dev/null)}")
    local git_dir=${discovery[1]:A} toplevel=${discovery[2]:A}
    local branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null)

    print "Repository: ${repo/#$HOME/~}"
    print "  resolved: ${resolved/#$HOME/~}"
    print "  format: $(git -C "$repo" rev-parse --show-ref-format 2>/dev/null)"
    benchmark_command 'repository lookup' \
      git -C "$repo" rev-parse --absolute-git-dir --show-toplevel
    benchmark_command 'full Git status' \
      git -C "$repo" status --porcelain=v2 --branch --show-stash --ahead-behind --no-renames
    if [[ -n $branch ]]; then
      benchmark_command 'branch metadata' \
        git -C "$repo" for-each-ref --count=1 \
          --format='refname=%(refname)%0aobjectname=%(objectname)%0aupstream=%(upstream:remoteref)%0aupstream_track=%(upstream:track,nobracket)%0asubject=%(contents:subject)' \
          "refs/heads/$branch"
    fi
    benchmark_command 'prompt collection (new)' \
      collect_prompt_status "$repo" '' ''
    benchmark_command 'prompt collection (refresh)' \
      collect_prompt_status "$repo" "$git_dir" "$toplevel"
    benchmark_startup 'interactive startup' "$repo"
    print
  done
done
