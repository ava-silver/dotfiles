#!/bin/bash

export REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";

# Set up shell

## oh-my-zsh
export ZSH=$HOME/.oh-my-zsh
export KEEP_ZSHRC=yes
if [ ! -d "$ZSH" ]; then
    sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
fi

ZSH_CUSTOM=$ZSH/custom

## p10k
if [ ! -d "$ZSH_CUSTOM/themes/powerlevel10k" ]; then
    git clone --depth=1 https://github.com/romkatv/powerlevel10k.git $ZSH_CUSTOM/themes/powerlevel10k
fi

## zsh-autosuggestions
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
    git clone https://github.com/zsh-users/zsh-autosuggestions $ZSH_CUSTOM/plugins/zsh-autosuggestions
fi
## zsh-syntax-highlighting
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $ZSH_CUSTOM/plugins/zsh-syntax-highlighting
fi
## autoswitch_virtualenv
if [ ! -d "$ZSH_CUSTOM/plugins/autoswitch_virtualenv" ]; then
    git clone https://github.com/MichaelAquilina/zsh-autoswitch-virtualenv.git $ZSH_CUSTOM/plugins/autoswitch_virtualenv
fi

## useful packages
brew tap oven-sh/bun
brew install lsd zoxide fzf bat git-delta pinentry-mac gh uv ruff rm-improved ripgrep gum difftastic mergiraf oven-sh/bun/bun
brew install --cask linearmouse macwhisper zed

# dock/appswitcher config
defaults write com.apple.dock appswitcher-all-displays -bool true
defaults write com.apple.dock autohide-time-modifier -float 0.15
defaults write com.apple.dock autohide-delay -float 0
killall Dock


## link up everything else
link() {
    local src="$1"
    local dst="$2"
    mkdir -p "$(dirname "$dst")"
    if [ -e "$dst" ]; then
        rm "$dst"
    fi
    ln -s "$src" "$dst"
}

home_link() {
    link "$REPO_DIR/$1" "$HOME/$1"
}

link_all() {
    for f in "$REPO_DIR/$1"/*; do
        link "$f" "$HOME/$1/$(basename $f)"
    done
}

## set up symlinks
link "$REPO_DIR/ssh_config" "$HOME/.ssh/config"
home_link .zshrc
home_link .zsh_aliases
home_link .p10k.zsh
home_link .gitconfig
home_link .gitattributes
link_all claude
link_all zed

[ ! -e "$HOME/skills" ] && gh repo clone skills "$HOME/skills"
bunx skills add "$HOME/skills" -g -a claude-code -y
