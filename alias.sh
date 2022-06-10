#!/usr/bin/bash

# Sets up the aliases and config to support minimal home directory
sudo echo "ZDOTDIR=$REPO_DIR" >> /etc/zshenv

sed -i "1i \
export XDG_CONFIG_HOME=$REPO_DIR\n\
export XDG_DATA_HOME=$REPO_DIR/data\n\
export XDG_STATE_HOME=$REPO_DIR/state\n\
export XDG_CACHE_HOME=$REPO_DIR/cache\n\
export ZSH=$REPO_DIR/.oh-my-zsh\n" $REPO_DIR/.zshrc

