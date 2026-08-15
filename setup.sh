#!/bin/bash
# THIS SCRIPT MUST REMAIN IDEMPOTENT
set -euo pipefail

export REPO_DIR
REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";

source "$REPO_DIR/shell/zsh_aliases.zsh"

link() {
    local src="$1"
    local dst="$2"
    mkdir -p "$(dirname "$dst")"
    if [ -e "$dst" ] || [ -L "$dst" ]; then
        /bin/rm -rf "$dst"
    fi
    ln -s "$src" "$dst"
    echo "Linked $src -> $dst"
}

# Link a repo file to a dotfile in $HOME (repo stores names without the leading dot).
dot_link() {
    link "$REPO_DIR/$1" "$HOME/$2"
}

config_link_all() {
    local src="$1"
    local dst="$2"
    local pattern="${3:-*}"
    mkdir -p "$HOME/$dst"
    for f in "$REPO_DIR/$src"/$pattern; do
        link "$f" "$HOME/$dst/$(basename "$f")"
    done
}

echo "Setting up symlinks..."
link "$REPO_DIR/tools/ssh_config" "$HOME/.ssh/config"
dot_link shell/zshrc.zsh .zshrc
dot_link shell/zsh_aliases.zsh .zsh_aliases
dot_link shell/p10k.zsh .p10k.zsh
dot_link git/.gitconfig .gitconfig
dot_link git/.gitattributes .gitattributes
dot_link git/gitignore_global .gitignore_global

## oh-my-zsh
echo -n "Installing oh-my-zsh..."
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

echo " done ✅"

# Skip the (serial, slow) bundle when everything is already installed.
if ! brew bundle check --file="$REPO_DIR/Brewfile" >/dev/null 2>&1; then
    brew bundle --file="$REPO_DIR/Brewfile"
fi

# Pi -- plugins are declared in pi/settings.json. Keep the runtime aligned with
# the extension SDK pinned in pi/extensions/package.json.
PI_VERSION="$(jq -r '.devDependencies["@earendil-works/pi-coding-agent"]' "$REPO_DIR/pi/extensions/package.json")"
bun install -g --ignore-scripts "@earendil-works/pi-coding-agent@$PI_VERSION"

# dock/appswitcher config
defaults write com.apple.dock appswitcher-all-displays -bool true
defaults write com.apple.dock autohide-time-modifier -float 0.15
defaults write com.apple.dock autohide-delay -float 0
killall Dock 2>/dev/null || true


## set up symlinks

# gh/gt wrappers and subernetes live in bin/; zshrc puts that dir on PATH ahead
# of /opt/homebrew/bin, so no symlinking is needed here.

# Pi config files are symlinked; resource directories are loaded directly from
# the repo via settings.json, so edits and newly added resources need no setup rerun.
link "$REPO_DIR/pi/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
link "$REPO_DIR/pi/settings.json" "$HOME/.pi/agent/settings.json"
link "$REPO_DIR/pi/keybindings.json" "$HOME/.pi/agent/keybindings.json"
link "$REPO_DIR/pi/models.json" "$HOME/.pi/agent/models.json"
link "$REPO_DIR/pi/pi-auto-rename.json" "$HOME/.pi/agent/extensions/pi-auto-rename.json"

# Install dependencies for local Pi extensions.
if command -v bun >/dev/null 2>&1; then
    (cd "$REPO_DIR/pi/extensions" && bun install --frozen-lockfile)
else
    echo "Warning: bun not found; Pi extension dependencies were not installed"
fi

config_link_all zed .config/zed
link "$REPO_DIR/ghostty/config.ghostty" "$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
link "$REPO_DIR/tools/lsd.yaml" "$HOME/.config/lsd/config.yaml"
echo "Done ✅"

echo -n "Verifying RTK hooks..."
if command -v rtk >/dev/null; then
    rtk init --show
else
    echo " skipped (rtk not on PATH)"
fi
echo " done ✅"


prek install
