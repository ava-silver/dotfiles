# dotfiles

Run `./setup.sh` to provision a new machine (idempotent). It installs packages
via the `Brewfile`, sets up oh-my-zsh + plugins, installs agent tooling, and
symlinks every config below into place.

## Layout

| Dir       | Contents                                                        |
| --------- | -------------------------------------------------------------- |
| `shell/`  | `zshrc`, `zsh_aliases`, `p10k.zsh`                              |
| `git/`    | `gitconfig`, `gitattributes`, and helper `scripts/` (git aliases) |
| `agents/` | Shared `AGENTS.md` + per-harness config (claude, codex, cursor, pi, mcp) |
| `editor/` | `zed/` settings + keymap                                        |
| `tools/`  | Misc tool configs (`lsd.yaml`, `ssh_config`, `fluidvoice.json`) |
| `fonts/`  | Nerd / coding fonts                                             |
| `misc/`   | Odds and ends (`subernetes.py`)                                 |
| `docs/`   | Setup notes -- see [terminal-setup.md](docs/terminal-setup.md) |

Configs are symlinked from the repo to their required locations, so edits here
take effect immediately.
