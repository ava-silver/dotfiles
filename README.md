# dotfiles

Run `./setup.sh` to provision a new machine (idempotent). It installs packages
via the `Brewfile`, sets up oh-my-zsh + plugins, installs Pi, and symlinks
configs into place.

## Layout

| Dir       | Contents                                                        |
| --------- | -------------------------------------------------------------- |
| `shell/`  | `zshrc`, `zsh_aliases`, `p10k.zsh`                              |
| `git/`    | `gitconfig`, `gitattributes`, `gitignore_global`, and helper `scripts/` (git aliases) |
| `pi/`     | Pi instructions, settings, extensions, skills, prompts, themes, and MCP config |
| `editor/` | `zed/` settings + keymap                                        |
| `tools/`  | Misc tool configs (`lsd.yaml`, `ssh_config`, `fluidvoice.json`) |
| `bin/`    | Executables on PATH straight from the repo (`gh`/`gt` wrappers, `subernetes`) |
| `fonts/`  | Nerd / coding fonts                                             |
| `docs/`   | Setup notes -- see [terminal-setup.md](docs/terminal-setup.md) |

Configs are symlinked from the repo to their required locations, so edits here
take effect immediately.
