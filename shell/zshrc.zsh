export PATH="/Users/ava/.bun/bin:$PATH"
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

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
  git
  zoxide
  fzf
  zsh-autosuggestions
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


export DO_NOT_TRACK=true
export GH_TELEMETRY=false

export HOMEBREW_NO_ENV_HINTS=1

export HOST_HOOK_RUNNER=1

export PATH="$PATH:$HOME/.local/bin"
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"


export EDITOR="zed --wait"

export FFF_ENABLE_HOME_SCAN=0


[[ ! -d $HOME/.cargo/bin ]] || path+=($HOME/.cargo/bin)
export GPG_TTY=$(tty)
command -v git-stk >/dev/null && source <(git stk completions zsh)
