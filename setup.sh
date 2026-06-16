#!/bin/bash
# THIS SCRIPT MUST REMAIN IDEMPOTENT
set -euo pipefail

export REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";

# Set up shell

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

## useful packages
brew tap oven-sh/bun
brew install lsd zoxide fzf bat git-delta pinentry-mac gh jq \
    uv ruff rm-improved ripgrep gum difftastic mergiraf bottom oven-sh/bun/bun \
    mq rtk
brew install --cask linearmouse macwhisper zed

# dock/appswitcher config
defaults write com.apple.dock appswitcher-all-displays -bool true
defaults write com.apple.dock autohide-time-modifier -float 0.15
defaults write com.apple.dock autohide-delay -float 0
killall Dock 2>/dev/null || true


## link up everything else
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

home_link() {
    link "$REPO_DIR/$1" "$HOME/$1"
}

config_link_all() {
    local src="$1"
    local dst="$2"
    mkdir -p "$HOME/$dst"
    for f in "$REPO_DIR/$src"/*; do
        link "$f" "$HOME/$dst/$(basename "$f")"
    done
}

## set up symlinks
echo "Setting up symlinks..."
link "$REPO_DIR/ssh_config" "$HOME/.ssh/config"
home_link .zshrc
home_link .zsh_aliases
home_link .p10k.zsh
home_link .gitconfig
home_link .gitattributes

# Agent config. RTK guidance lives in AGENTS.md (idempotent `rtk` prefix works on
# every harness); Claude/Cursor additionally rewrite via a PreToolUse hook, Codex
# is instruction-only (rtk has no Codex hook).
link "$REPO_DIR/agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"
config_link_all agents/claude .claude
# ccstatusline reads the XDG path first; keep it pointed at the repo config.
link "$REPO_DIR/agents/claude/ccstatusline.json" "$HOME/.config/ccstatusline/settings.json"

link "$REPO_DIR/agents/AGENTS.md" "$HOME/.codex/AGENTS.md"
link "$REPO_DIR/agents/codex/config.toml" "$HOME/.codex/config.toml"
link "$REPO_DIR/agents/codex/computer-use-config.json" "$HOME/.codex/computer-use/config.json"

link "$REPO_DIR/agents/AGENTS.md" "$HOME/.cursor/AGENTS.md"
config_link_all agents/cursor .cursor

config_link_all zed .config/zed
link "$REPO_DIR/lsd_config.yaml" "$HOME/.config/lsd/config.yaml"
echo "Done ✅"

echo -n "Verifying RTK hooks..."
if command -v rtk >/dev/null; then
    rtk init --show
else
    echo " skipped (rtk not on PATH)"
fi
echo " done ✅"

echo -n "Installing skills..."
skills_repos=(
    "https://github.com/ava-silver/skills"
    "https://github.com/mattpocock/skills"
    "https://github.com/harehare/mq/tree/main/skills"
)
for repo in "${skills_repos[@]}"; do
    bunx skills add "$repo" -g -a claude-code -y > /dev/null
done
echo " done ✅"
