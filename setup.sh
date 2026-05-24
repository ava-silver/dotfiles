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
brew install lsd zoxide fzf bat git-delta pinentry-mac gh uv ruff rm-improved ripgrep gum difftastic mergiraf
brew install --cask unnaturalscrollwheels macwhisper zed

# dock/appswitcher config
defaults write com.apple.dock appswitcher-all-displays -bool true
defaults write com.apple.dock autohide-time-modifier -float 0.15
defaults write com.apple.dock autohide-delay -float 0
killall Dock


## link up everything else

## set up symlinks
if [ ! -e "$HOME/.ssh/config" ]; then
    mkdir -p $HOME/.ssh && ln -s $REPO_DIR/ssh_config $HOME/.ssh/config
fi
if [ ! -e "$HOME/.zshrc" ]; then
    ln -s $REPO_DIR/.zshrc $HOME/.zshrc
fi
if [ ! -e "$HOME/.zsh_aliases" ]; then
    ln -s $REPO_DIR/.zsh_aliases $HOME/.zsh_aliases
fi
if [ ! -e "$HOME/.p10k.zsh" ]; then
    ln -s $REPO_DIR/.p10k.zsh $HOME/.p10k.zsh
fi
if [ -e "$HOME/.gitconfig" ]; then
    rm $HOME/.gitconfig
fi
ln -s $REPO_DIR/.gitconfig $HOME/.gitconfig
if [ -e "$HOME/.gitattributes" ]; then
    rm $HOME/.gitattributes
fi
ln -s $REPO_DIR/.gitattributes $HOME/.gitattributes

if [ ! -e "$HOME/.claude/CLAUDE.md" ]; then
    mkdir -p $HOME/.claude && ln -s $REPO_DIR/claude/CLAUDE.md $HOME/.claude/CLAUDE.md
fi
gh repo clone skills "$HOME/skills"
bunx skills add "$HOME/skills" -g -y
mkdir -p $HOME/.config/zed
for f in $REPO_DIR/zed/*; do
    target="$HOME/.config/zed/$(basename $f)"
    if [ ! -e "$target" ]; then
        ln -s $f $target
    fi
done
