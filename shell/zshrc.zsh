# BEGIN ANSIBLE MANAGED BLOCK
# Load homebrew shell variables
eval "$(/opt/homebrew/bin/brew shellenv)"

# Force certain more-secure behaviours from homebrew
export HOMEBREW_NO_INSECURE_REDIRECT=1
export HOMEBREW_CASK_OPTS=--require-sha
export HOMEBREW_DIR=/opt/homebrew
export HOMEBREW_BIN=/opt/homebrew/bin

# Load ruby shims
eval "$(rbenv init -)"

# Load direnv hook
eval "$(direnv hook zsh)"

# Load git-dd completions for zsh
autoload -Uz _git_dd

# Prefer GNU binaries to Macintosh binaries.
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"

# Add datadog devtools binaries to the PATH
export PATH="$HOME/dd/devtools/bin:$PATH"

# Point GOPATH to our go sources
export GOPATH="$HOME/go"

# Add binaries that are go install-ed to PATH
export PATH="$GOPATH/bin:$PATH"

# Point DATADOG_ROOT to ~/dd symlink
export DATADOG_ROOT="$HOME/dd"

# Tell the devenv vm to mount $GOPATH/src rather than just dd-go
export MOUNT_ALL_GO_SRC=1


# Helm switch from storing objects in kubernetes configmaps to
# secrets by default, but we still use the old default.
export HELM_DRIVER=configmap

# Go 1.16+ sets GO111MODULE to off by default with the intention to
# remove it in Go 1.18, which breaks projects using the dep tool.
# https://blog.golang.org/go116-module-changes
export GO111MODULE=auto
# Configure Go to pull go.ddbuild.io packages.
export GONOSUMDB=github.com/DataDog,go.ddbuild.io
export GOPRIVATE=
export GOPROXY="https://depot-read-api-go.us1.ddbuild.io/magicmirror/magicmirror/@current/|https://depot-read-api-go.us1.ddbuild.io/magicmirror/magicmirror/@current/|https://depot-read-api-go.us1.ddbuild.io/magicmirror/testing/@current/"
# END ANSIBLE MANAGED BLOCK

# bun
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
export PATH="$HOME/dotfiles/bin:$PATH"

[[ $- != *i* ]] && return
# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi


ZSH_DISABLE_COMPFIX="true"
HYPHEN_INSENSITIVE="true"

zstyle ':omz:update' mode reminder
zstyle ':omz:update' frequency 13

COMPLETION_WAITING_DOTS="true"
HIST_STAMPS="mm/dd/yyyy"

export _ZO_EXCLUDE_DIRS="$HOME/go/src/github.com/DataDog"

plugins=(
  git
  zoxide
  fzf
  zsh-autosuggestions
  vscode
  zsh-syntax-highlighting
  autoswitch_virtualenv
)

fpath+=${ZSH_CUSTOM:-${ZSH:-~/.oh-my-zsh}/custom}/plugins/zsh-completions/src
# oh-my-zsh initializes compinit after registering all plugin completion paths.
source "$HOME/.oh-my-zsh/oh-my-zsh.sh"

# User configuration

# You may need to manually set your language environment
export LANG=en_US.UTF-8

source "$HOME/.oh-my-zsh/custom/themes/powerlevel10k/powerlevel10k.zsh-theme"

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f $HOME/.p10k.zsh ]] || source $HOME/.p10k.zsh

source $HOME/.zsh_aliases
[[ ! -f $HOME/.cargo_vars ]] || source $HOME/.cargo_vars



export GITLAB_TOKEN=$(security find-generic-password -a ${USER} -s GITLAB_TOKEN -w)

export DO_NOT_TRACK=true
export GH_TELEMETRY=false

export HOMEBREW_NO_ENV_HINTS=1

export HOST_HOOK_RUNNER=1

export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:${PATH?}"
export NODE_OPTIONS="--max-old-space-size=30000"

path+=("$HOME/dd/eclair-scripts/bin" "$HOME/dd/eclair-scripts/azure/bin")
export PATH="$PATH:$HOME/.local/bin"


export EDITOR="zed --wait"

# Do not retain previous local Terraform state snapshots.
export TF_CLI_ARGS_apply="-backup=-"
export TF_CLI_ARGS_destroy="-backup=-"

# Generate command completions only when they are first requested.
if (( $+commands[kubectl] )); then
  _load_kubectl_completion() {
    unfunction _load_kubectl_completion
    source <(command kubectl completion zsh)
    _kubectl "$@"
  }
  compdef _load_kubectl_completion kubectl
fi

if (( $+commands[gt] )); then
  _load_gt_completion() {
    unfunction _load_gt_completion
    source <(command gt completion)
    _gt_yargs_completions "$@"
  }
  compdef _load_gt_completion gt
fi



[[ ! -f $HOME/.config/dogweb.shellrc ]] || source "$HOME/.config/dogweb.shellrc"

[[ ! -d $HOME/.cargo/bin ]] || path+=($HOME/.cargo/bin)
export PYENCHANT_LIBRARY_PATH=/opt/homebrew/lib/libenchant-2.2.dylib
export GPG_TTY=$(tty)


autoload -U +X bashcompinit && bashcompinit
complete -o nospace -C /opt/homebrew/bin/terraform terraform

# BEGIN SCFW MANAGED BLOCK
alias npm="scfw run npm"
alias pip="scfw run pip"
alias poetry="scfw run poetry"
export SCFW_DD_AGENT_LOG_PORT="10365"
export SCFW_DD_LOG_LEVEL="ALLOW"
export SCFW_HOME="/Users/ava.silver/.scfw"
# END SCFW MANAGED BLOCK

# Added by Yarn Switch
source "/Users/ava.silver/.yarn/switch/env"

eval "$(cdd init)"
export GITLAB_HOST=gitlab.ddbuild.io
