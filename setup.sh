#!/bin/bash
# THIS SCRIPT MUST REMAIN IDEMPOTENT
set -euo pipefail

export REPO_DIR
REPO_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]:-$0}"; )" &> /dev/null && pwd 2> /dev/null; )";


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

# pi -- plugins are declared in agents/pi/settings.json.
bun install -g --ignore-scripts @earendil-works/pi-coding-agent

# dock/appswitcher config
defaults write com.apple.dock appswitcher-all-displays -bool true
defaults write com.apple.dock autohide-time-modifier -float 0.15
defaults write com.apple.dock autohide-delay -float 0
killall Dock 2>/dev/null || true


## set up symlinks

# gh/gt wrappers and subernetes live in bin/; zshrc puts that dir on PATH ahead
# of /opt/homebrew/bin, so no symlinking is needed here.

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

link "$REPO_DIR/agents/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
config_link_all agents/pi .pi/agent "*.json"
# pi-only skills (kept out of the shared ~/.agents/skills so other agents don't load them).
config_link_all agents/pi/skills .pi/agent/skills
# pi extensions and themes (symlinks every entry so new ones need no setup.sh changes).
# The extensions root holds shared type-checking tooling; standalone extension packages
# are linked explicitly so their runtime dependencies resolve through the package directory.
config_link_all agents/pi/extensions .pi/agent/extensions "*.ts"
if command -v bun >/dev/null 2>&1; then
    (cd "$REPO_DIR/agents/pi/extensions/subagents" && bun install --frozen-lockfile)
    (cd "$REPO_DIR/agents/pi/extensions/ask-user" && bun install --frozen-lockfile)
    (cd "$REPO_DIR/agents/pi/extensions/workflows" && bun install --frozen-lockfile)
else
    echo "Warning: bun not found; Pi extension dependencies were not installed"
fi
link "$REPO_DIR/agents/pi/extensions/subagents" "$HOME/.pi/agent/extensions/subagents"
link "$REPO_DIR/agents/pi/extensions/ask-user" "$HOME/.pi/agent/extensions/ask-user"
link "$REPO_DIR/agents/pi/extensions/workflows" "$HOME/.pi/agent/extensions/workflows"
link "$REPO_DIR/agents/pi/extensions/shared" "$HOME/.pi/agent/extensions/shared"
config_link_all agents/pi/themes .pi/agent/themes
config_link_all agents/pi/prompts .pi/agent/prompts "*.md"

# Shared MCP server config, consumed by pi-mcp-adapter and other hosts.
link "$REPO_DIR/agents/mcp/mcp.json" "$HOME/.config/mcp/mcp.json"

config_link_all editor/zed .config/zed
link "$REPO_DIR/terminal/ghostty/config.ghostty" "$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
link "$REPO_DIR/tools/lsd.yaml" "$HOME/.config/lsd/config.yaml"
echo "Done ✅"

echo -n "Verifying RTK hooks..."
if command -v rtk >/dev/null; then
    rtk init --show
else
    echo " skipped (rtk not on PATH)"
fi
echo " done ✅"

echo "Installing skills..."
skills_paths=(
    "ava-silver/skills"
    "mattpocock/skills/tree/main/skills/engineering/code-review"
    "harehare/mq/tree/main/skills"
)
for skill in "${skills_paths[@]}"; do
    bunx skills add "https://github.com/$skill" -g -a universal claude-code -y > /dev/null
done
echo " done ✅"
