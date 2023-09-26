#!/usr/bin/zsh

# DNF Apps
sudo dnf install firefox snapd solaar gimp gnome-tweaks nextcloud-client python3 rust cargo ImageMagick ranger sqlite3 vim -y --allowerasing


# Flatpak apps
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
sudo flatpak install flathub com.spotify.Client -y
sudo flatpak install flathub com.slack.Slack -y
sudo flatpak install flathub com.bitwarden.desktop -y
sudo flatpak install flathub com.github.tchx84.Flatseal -y
sudo flatpak install flathub com.mattjakeman.ExtensionManager -y
sudo flatpak install flathub com.microsoft.Edge -y
sudo flatpak install flathub com.github.GradienceTeam.Gradience -y
sudo flatpak install flathub com.github.micahflee.torbrowser-launcher -y
sudo flatpak install flathub com.google.AndroidStudio -y
sudo flatpak install flathub com.valvesoftware.Steam -y
sudo flatpak install flathub com.mattjakeman.ExtensionManager -y

# Snap apps
[ ! -L "/snap" ] && sudo ln -s /var/lib/snapd/snap /snap
sudo snap install code --classic


## Other:
# Celeste to /usr/games/celeste

# Minecraft
# Monero GUI

