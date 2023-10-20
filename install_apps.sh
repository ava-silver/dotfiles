#!/usr/bin/zsh

# APT Apps
sudo apt install flatpak gnome-software-plugin-flatpak solaar gimp\
    gnome-tweaks python3 cargo imagemagick ranger sqlite3 vim -y

# Flatpak apps
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
sudo flatpak install flathub com.github.tchx84.Flatseal -y
sudo flatpak install flathub com.mattjakeman.ExtensionManager -y
sudo flatpak install flathub com.github.micahflee.torbrowser-launcher -y
sudo flatpak install flathub com.mattjakeman.ExtensionManager -y
sudo flatpak install flathub org.getmonero.Monero -y

# Snap apps
sudo snap install code --classic
sudo snap install android-studio --classic
sudo snap install spotify
sudo snap install bitwarden
sudo snap install discord
sudo snap install steam


## Other:

# Gum
sudo mkdir -p /etc/apt/keyrings
if [ ! -f "/etc/apt/keyrings/charm.gpg" ]; then
    curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg
fi
if [ ! -f "/etc/apt/sources.list.d/charm.list" ]; then
    echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" | sudo tee /etc/apt/sources.list.d/charm.list
fi
sudo apt update
sudo apt install gum

# Celeste to /usr/games/celeste
# Minecraft


