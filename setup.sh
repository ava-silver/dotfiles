#!/usr/bin/bash

export REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";

# Set up shell

## zsh
sudo dnf install zsh -y

## oh-my-zsh
export ZSH=$REPO_DIR/.oh-my-zsh
export KEEP_ZSHRC=yes
export RUNZSH=no
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

ZSH_CUSTOM=$ZSH/custom

## p10k
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git $ZSH_CUSTOM/themes/powerlevel10k

## zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-autosuggestions $ZSH_CUSTOM/plugins/zsh-autosuggestions

## zsh-syntax-highlighting
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git $ZSH_CUSTOM/plugins/zsh-syntax-highlighting

## useful packages
sudo dnf install lsd thefuck zoxide fzf bat bpytop -y

## link up everything else
sudo bash -c "echo 'ZDOTDIR=$REPO_DIR' >> /etc/zshenv"

zsh ./install_apps.sh

