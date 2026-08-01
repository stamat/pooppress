#!/usr/bin/env bash
# pooppress VPS installer: Node, the package, the wizard, a systemd unit and
# optionally Caddy for automatic HTTPS. Nothing else to set up.
#
#   curl -fsSL https://pooppress.dev/install.sh | bash
set -euo pipefail

SITE_DIR="${POOPPRESS_DIR:-/var/lib/pooppress}"
SERVICE_USER="${POOPPRESS_USER:-pooppress}"
PORT="${PORT:-3000}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo)."

log "Checking Node.js"
if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  echo "Node $(node -v) is fine."
else
  echo "Installing Node.js 22..."
  if have apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif have dnf; then
    dnf module install -y nodejs:22
  else
    die "no apt-get or dnf — install Node.js 20+ yourself and rerun."
  fi
fi

log "Installing pooppress"
npm install -g pooppress

log "Creating the service user and site directory"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$SITE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$SITE_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$SITE_DIR"

log "Running the setup wizard"
cd "$SITE_DIR"
# Under `curl | bash` stdin is the script itself — if the wizard read it, the
# rest of this file would become its answers. It must read the terminal.
( : </dev/tty ) 2>/dev/null || die "no terminal available — run: cd $SITE_DIR && sudo -u $SERVICE_USER pooppress init"
sudo -u "$SERVICE_USER" PORT="$PORT" pooppress init </dev/tty

log "Writing the systemd unit"
cat > /etc/systemd/system/pooppress.service <<UNIT
[Unit]
Description=pooppress
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SITE_DIR
Environment=PORT=$PORT
Environment=NODE_ENV=production
ExecStart=$(command -v pooppress) start
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$SITE_DIR

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now pooppress
echo "pooppress is running on port $PORT."

# Same terminal rule as the wizard: under `curl | bash`, [ -t 0 ] is false
# even on an interactive box, so ask via /dev/tty.
if ( : </dev/tty ) 2>/dev/null; then
  read -r -p $'\nInstall Caddy and serve the admin over HTTPS? [y/N] ' reply </dev/tty
  if [[ "${reply:-n}" =~ ^[Yy]$ ]]; then
    read -r -p "Admin hostname (e.g. cms.example.com): " HOSTNAME </dev/tty
    have caddy || {
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update && apt-get install -y caddy
    }
    cat >> /etc/caddy/Caddyfile <<CADDY

$HOSTNAME {
    reverse_proxy localhost:$PORT
}
CADDY
    systemctl reload caddy
    echo "Admin: https://$HOSTNAME/admin"
  fi
fi

log "Done"
echo "Site directory: $SITE_DIR (back it up with: cp -r $SITE_DIR /somewhere)"
echo "Logs: journalctl -u pooppress -f"
