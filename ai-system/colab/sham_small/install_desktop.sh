#!/usr/bin/env sh
# Installs what Sham's embedded graphical desktop (sham_desktop.py) needs on a Debian/Ubuntu host. Idempotent and non-interactive; run it once wherever the model is hosted
# (a Dockerfile RUN line, a start-up script, a new server). Needs root (or sudo). Without it the desktop answers "missing: ..." and the terminal/browser keep working.
set -eu
need="xvfb xauth xdotool openbox xterm pcmanfm xclip wmctrl scrot"
missing=""
for p in $need; do dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"; done
[ -z "$missing" ] && { echo "desktop packages already installed"; exit 0; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
$SUDO apt-get update -qq
DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y --no-install-recommends $missing
echo "installed:$missing"
