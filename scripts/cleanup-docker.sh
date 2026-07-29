#!/usr/bin/env bash
# ==========================================================================
# OpenBooks — wipe ALL Docker apps + data on this host to start fresh.
#
# DESTRUCTIVE: removes every container, image, volume, network, and build
# cache. Docker Engine itself stays installed unless you pass --reinstall.
#
# Intended for repurposing a host (e.g. tcc-linux-vm1) for OpenBooks AFTER you
# have migrated everything else off it. Take a VM snapshot first.
#
# Usage:
#   ./cleanup-docker.sh              # prune everything, keep Docker Engine
#   ./cleanup-docker.sh --reinstall  # also purge + reinstall Docker Engine
# ==========================================================================
set -euo pipefail

REINSTALL=0
[ "${1:-}" = "--reinstall" ] && REINSTALL=1
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on this host. Nothing to clean."
  [ "$REINSTALL" -eq 1 ] || exit 0
fi

echo "=================================================================="
echo " Current Docker state on $(hostname)"
echo "=================================================================="
docker ps -a || true
echo "--- images ---";  docker images || true
echo "--- volumes ---"; docker volume ls || true
echo "--- disk ---";    docker system df || true
echo
echo "This PERMANENTLY DELETES all of the above: containers, images,"
echo "volumes (all app DATA), networks, and build cache."
[ "$REINSTALL" -eq 1 ] && echo "It will ALSO uninstall and reinstall Docker Engine."
echo
read -r -p 'Type WIPE to continue: ' ans
[ "$ans" = "WIPE" ] || { echo "Aborted."; exit 1; }

echo "==> Stopping + removing all containers..."
docker ps -aq | xargs -r docker rm -f

echo "==> Removing all images, networks, build cache, and volumes..."
docker system prune -a --volumes -f

echo "==> Removing any remaining named volumes..."
docker volume ls -q | xargs -r docker volume rm -f

echo "==> Pruning remaining networks..."
docker network prune -f

echo
echo "==> Remaining (should be empty):"
docker ps -a; docker images; docker volume ls; docker system df

if [ "$REINSTALL" -eq 1 ]; then
  echo
  echo "==> Full reinstall: stopping + purging Docker Engine and its data..."
  $SUDO systemctl stop docker 2>/dev/null || true
  $SUDO apt-get purge -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin docker.io 2>/dev/null || true
  $SUDO rm -rf /var/lib/docker /var/lib/containerd /etc/docker
  echo "==> Reinstalling Docker Engine from get.docker.com..."
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" || true
  echo "Reinstalled. Log out/in (or run 'newgrp docker') for group membership."
fi

echo
echo "Done — Docker is clean."
echo "NOTE: bind-mounted app data directories on the host disk are NOT removed"
echo "by this script (only Docker-managed volumes are). If your old stacks kept"
echo "data in e.g. /opt/<app>, /srv, or ~/<app>, review and remove those dirs"
echo "manually. List big directories with:  sudo du -xhd1 / | sort -h | tail -20"
