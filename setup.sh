#!/usr/bin/bash


## oh-my-zsh
export ZSH=$HOME/.oh-my-zsh
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

## useful packagges 
brew install lsd thefuck zoxide fzf bat bpytop rm-improved

# unnatural scroll wheels, rectangle, yubikey manager, clipy will all need to be installed as well.

# link zshrc, .p10k.zsh and zsh_aliases
ln -s /Users/ava.silver/.dotfiles/.p10k.zsh /Users/ava.silver/.p10k.zsh
ln -s /Users/ava.silver/.dotfiles/.zshrc /Users/ava.silver/.zshrc
ln -s /Users/ava.silver/.dotfiles/.zsh_aliases /Users/ava.silver/.zsh_aliases

# install fonts
cp /Users/ava.silver/.dotfiles/fonts/* /Users/ava.silver/Library/Fonts/

