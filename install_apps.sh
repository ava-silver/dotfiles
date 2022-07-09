#!/usr/bin/zsh

# DNF Apps
sudo dnf install alacritty bitwarden snapd solaar gimp gnome-tweaks nextcloud-client python3 rust ImageMagick ffmpeg ranger vim
sudo dnf module install nodejs:14


# Flatpak apps
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
sudo flatpak install flathub com.spotify.Client
sudo flatpak install flathub com.slack.Slack
sudo flatpak install flathub com.bitwarden.desktop
sudo flatpak install flathub com.github.tchx84.Flatseal
sudo flatpak install flathub com.mattjakeman.ExtensionManager
sudo flatpak install flathub com.microsoft.Edge

# Snap apps
sudo snap install code --classic


## Other:
# Celeste
# Minecraft
# Tor
# Monero GUI


