#!/bin/bash
# Prepara una VM Ubuntu Server (24.04/26.04) para correr el inventario con Docker.
# Se corre una sola vez, como root:   sudo bash setup-vm.sh <usuario>
# Después, como ese usuario: clonar el repo, armar el .env y `docker compose up -d --build`
# (README de la raíz y deploy/nginx/README.md).
set -euo pipefail

USER_NAME="${1:-${SUDO_USER:-}}"
if [ -z "$USER_NAME" ] || ! id "$USER_NAME" >/dev/null 2>&1; then
    echo "Uso: sudo bash setup-vm.sh <usuario>" >&2
    exit 1
fi
export DEBIAN_FRONTEND=noninteractive

echo "== Paquetes del sistema y actualizaciones"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl git ufw unattended-upgrades

echo "== Docker (paquetes de Ubuntu: se actualizan solos con el resto del sistema)"
apt-get -y -q install docker.io docker-compose-v2 docker-buildx
systemctl enable --now docker            # arranca con la VM; la app tiene restart: unless-stopped
usermod -aG docker "$USER_NAME"          # para usar docker sin sudo (vale desde el próximo login)

echo "== Actualizaciones de seguridad automáticas"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Firewall: SSH y HTTPS"
# Ojo: los puertos que publica Docker (80/443 de Caddy) no pasan por ufw. El acceso público
# igual llega solo por ticktera (nginx de la oficina).
ufw allow OpenSSH
ufw allow 443/tcp
ufw --force enable

echo "== Zona horaria"
timedatectl set-timezone America/Argentina/Buenos_Aires

echo
echo "Listo. Cerrá la sesión y volvé a entrar para usar docker sin sudo."
docker --version
docker compose version
