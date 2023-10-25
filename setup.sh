#!/usr/bin/bash

export REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";

# Set up shell

## zsh
sudo apt update
sudo apt install zsh git curl -y

## oh-my-zsh
export ZSH=$REPO_DIR/.oh-my-zsh
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
## useful packages
sudo apt install thefuck fzf bat -y
if [ $(whoami) = "bits" ]; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    brew install lsd
    brew install zoxide
    brew install diff-so-fancy
else
    sudo snap install diff-so-fancy
    sudo apt install lsd zoxide -y
fi


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

chsh -s `which zsh`

