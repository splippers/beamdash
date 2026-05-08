#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root." >&2
    exit 1
fi

cd "$(dirname "$0")"
BEAMDASH_ROOT="/opt/beamdash"

echo "=== beamdash Installer ==="

echo "Installing to ${BEAMDASH_ROOT}..."
mkdir -p "$BEAMDASH_ROOT"
cp -a bin conf lib beamctl "$BEAMDASH_ROOT/"

echo "Creating beammp user..."
id -u beammp &>/dev/null || useradd -r -s /sbin/nologin -M beammp

echo "Setting permissions..."
chown -R beammp:beammp "$BEAMDASH_ROOT"
chmod +x "$BEAMDASH_ROOT/bin/BeamMP-Server" "$BEAMDASH_ROOT/beamctl" "$BEAMDASH_ROOT/lib/api.py"

echo "Installing beamctl symlink..."
ln -sf "$BEAMDASH_ROOT/beamctl" /usr/local/bin/beamctl

echo "Creating /etc/beamdash config..."
mkdir -p /etc/beamdash
for f in beamdash.conf api.conf; do
    if [[ ! -f "/etc/beamdash/$f" ]]; then
        cp "$BEAMDASH_ROOT/conf/$f" "/etc/beamdash/$f"
    fi
done

echo "Installing systemd services..."
cp "$BEAMDASH_ROOT/conf/beammp@.service" /etc/systemd/system/beammp@.service
cp "$BEAMDASH_ROOT/conf/beammp-api.service" /etc/systemd/system/beammp-api.service
systemctl daemon-reload

echo "Checking dependencies..."
MISSING=()
for pkg in liblua5.3-0 libssl3 libcurl4; do
    dpkg -s "$pkg" &>/dev/null || MISSING+=("$pkg")
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "Missing packages: ${MISSING[*]}"
    read -rp "Install now? [Y/n] " reply
    [[ "$reply" =~ ^[nN] ]] || apt-get update && apt-get install -y "${MISSING[@]}"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Quick start:"
echo "  beamctl create myserver"
echo "  beamctl set myserver AuthKey=<your-key>"
echo "  beamctl mod pool myserver          # see available mods"
echo "  beamctl mod enable myserver map.zip # add mod"
echo "  beamctl mod sync myserver          # deploy mods"
echo "  beamctl start myserver"
echo ""
echo "Map presets (switch maps + mods):"
echo "  beamctl preset myserver save monaco"
echo "  beamctl preset myserver load monaco"
echo ""
echo "Web API (remote management):"
echo "  beamctl api key    # get your API key"
echo "  beamctl api start  # start on port 8999"
echo "  curl -H 'X-API-Key: <key>' http://localhost:8999/"
echo ""
echo "Or via systemd:"
echo "  systemctl enable --now beammp@myserver"
