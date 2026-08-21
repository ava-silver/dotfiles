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
sudo bash -c "cat $REPO_DIR/tools/dnf.conf > /etc/dnf/dnf.conf"
dot_link shell/zshrc.zsh .zshrc
dot_link shell/zsh_aliases.zsh .zsh_aliases
dot_link shell/p10k.zsh .p10k.zsh
dot_link git/.gitconfig .gitconfig
dot_link git/gitignore_global .gitignore_global

## oh-my-zsh
echo -n "Installing oh-my-zsh..."
sudo dnf install zsh -y
export ZSH=$REPO_DIR/.oh-my-zsh
export KEEP_ZSHRC=yes
export RUNZSH=no
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

## useful packages
sudo dnf install lsd zoxide fzf bat -y

if [ ! -d "$HOME/.bun" ]; then
    curl -fsSL https://bun.com/install | bash
fi

# Pi -- plugins are declared in pi/settings.json. Keep the runtime aligned with
# the extension SDK pinned in pi/extensions/package.json.
PI_VERSION="$(jq -r '.devDependencies["@earendil-works/pi-coding-agent"]' "$REPO_DIR/pi/extensions/package.json")"
bun install -g --ignore-scripts "@earendil-works/pi-coding-agent@$PI_VERSION"


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
link "$REPO_DIR/ghostty/config.ghostty" "$HOME/.config/ghostty/config"
link "$REPO_DIR/tools/lsd.yaml" "$HOME/.config/lsd/config.yaml"
echo "Done ✅"

prek install




## link up everything else
zsh ./install_apps.sh
