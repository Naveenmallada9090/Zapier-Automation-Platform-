#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu VM (tested against Oracle Cloud Always Free).
# Installs docker, docker compose and opens ports 80/443 in the local firewall.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "run this as the normal user (it uses sudo), not as root" >&2
    exit 1
fi

echo "== installing docker"

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nano

sudo install -m 0755 -d /etc/apt/keyrings

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"

echo "== opening ports 80 and 443"

# Oracle's Ubuntu images only allow ssh by default: iptables drops every other
# port before the security list is even consulted. Default dockerd also writes
# rules late, so put these at the very top of the INPUT chain.
for port in 80 443; do
    if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
        sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    fi
done

sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo
echo "setup finished. log out and back in so the docker group applies, then:"
echo
echo "  git clone https://github.com/Naveenmallada9090/zapier.git"
echo "  cd zapier"
echo "  cp .env.example .env"
echo "  nano .env"
echo "  docker compose up -d --build"
echo "  docker compose run --rm primary-backend npx ts-node prisma/seed.ts"
echo
echo "see DEPLOY-ORACLE.md for the values to put in .env"
