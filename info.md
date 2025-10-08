## Terminal Setup

For Mac, I use ITerm2: `brew install --cask iterm2`

### Basics

To begin, [Install Oh-My-Zsh](https://github.com/ohmyzsh/ohmyzsh#basic-installation):
```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

Note: This will create a backup of your current zshrc in ~/.zshrc.pre-oh-my-zsh. If you ran the laptop setup script before installing oh-my-zsh you might want to copy these contents back into your zshrc. You can automatically copy the old zshrc to the top of your new zshrc by running:
```sh
cat ~/.zshrc.pre-oh-my-zsh ~/.zshrc > temp && mv temp ~/.zshrc
```

### Aesthetics

1. Choose a custom nerd font to get icons in your terminal: https://www.nerdfonts.com/font-downloads
2. Set it in your terminal as your font (in ITerm, this is under Cmd+, > Profiles > Text)
3. Add powerlevel10k for a nice powerline theme: https://github.com/romkatv/powerlevel10k#oh-my-zsh


### Plugins

You can add the following plugins for an improved terminal experience:

1. zsh-syntax-highlighting: https://github.com/zsh-users/zsh-syntax-highlighting/blob/master/INSTALL.md#oh-my-zsh
   1. Provides an IDE-like syntax highlighting experience for your terminal
2. zsh-autosuggestions: https://github.com/zsh-users/zsh-autosuggestions/blob/master/INSTALL.md#oh-my-zsh
   1. Provides autocomplete (by pressing the right arrow key) for your most recent/frequent commands based on the beginning of what you type

### Util Commands

There a handful of commands which replace the builtin linux commands which I personally alias to their base counterparts (totally optional):

| base command | upgraded command                              |
| ------------ | --------------------------------------------- |
| cat          | [bat](https://github.com/sharkdp/bat)         |
| cd           | [z](https://github.com/ajeetdsouza/zoxide)    |
| rm           | [rip](https://github.com/nivekuil/rip)        |
| ls           | [lsd](https://github.com/lsd-rs/lsd)          |
| grep         | [rg](https://github.com/BurntSushi/ripgrep)   |
| top          | [btm](https://github.com/ClementTsang/bottom) |

Install them all with:
```sh
brew install bat zoxide rm-improved lsd ripgrep bottom
# add 'zoxide' to the plugins section of your .zshrc


