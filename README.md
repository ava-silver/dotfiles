# dotfiles

Run `./setup.sh` to provision a new machine (idempotent). It installs packages
via the `Brewfile`, sets up oh-my-zsh + plugins, installs Pi, and symlinks
configs into place.

## Layout

| Dir        | Contents |
| ---------- | -------- |
| `bin/`     | PATH executables, including `gh`/`gt` wrappers and `subernetes` |
| `docs/`    | Setup notes -- see [terminal-setup.md](docs/terminal-setup.md) |
| `fonts/`   | Nerd and coding fonts |
| `ghostty/` | Ghostty configuration |
| `git/`     | Git configuration and helper scripts |
| `pi/`      | Pi configuration, extensions, prompts, themes, and MCP config |
| `shell/`   | Zsh and Powerlevel10k configuration |
| `tools/`   | Shared tool configuration, including SSH and lsd |
| `zed/`     | Zed settings and keymap |

`setup.sh` symlinks the applicable configuration files into place. Pi loads its
resource directories directly from this repository, so changes take effect
immediately.
