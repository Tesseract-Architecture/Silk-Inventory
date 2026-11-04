#!/bin/bash
# Publica el inventario en https://inventario.silk-technologies.com desde este nginx (ticktera).
# Correr desde esta carpeta como admin, con la IP de la VM del inventario:
#     sudo bash install-inventario.sh 192.168.X.Y
# No toca los sitios de pilot, splunk ni zammad; si nginx -t falla, no recarga nada.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=inventario.silk-technologies.com
IP="${1:-}"

if ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "Uso: sudo bash install-inventario.sh <IP de la VM del inventario>" >&2
    exit 1
fi

# 0. Que la VM conteste antes de publicar nada (Caddy en el 443 con SITE_ADDRESS=$DOMAIN).
if ! curl -sk --max-time 5 --resolve "$DOMAIN:443:$IP" -o /dev/null "https://$DOMAIN/healthz"; then
    echo "La VM $IP no contesta https://$DOMAIN/healthz: ¿está levantado docker compose y SITE_ADDRESS=$DOMAIN?" >&2
    exit 1
fi

# 1. El certificado primero (el sitio lo referencia). El puerto 80 es el sitio de redirección,
#    que sirve /.well-known/acme-challenge/ desde /var/www/letsencrypt.
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" \
        --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
fi

# 2. El sitio y su snippet de proxy, con la IP de la VM.
sed "s/__INVENTARIO_IP__/$IP/" inventario-proxy.conf > /etc/nginx/snippets/inventario-proxy.conf
chmod 644 /etc/nginx/snippets/inventario-proxy.conf
install -m 644 "$DOMAIN" "/etc/nginx/sites-available/$DOMAIN"
ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"

# 3. Verificar y recargar (si falla, se saca el sitio y se corta).
if ! nginx -t; then
    rm -f "/etc/nginx/sites-enabled/$DOMAIN"
    echo "nginx -t falló: se sacó el sitio del inventario, no se recargó nada." >&2
    exit 1
fi
systemctl reload nginx
# Renovación: el timer de certbot renueva todos los certificados y este host ya recarga nginx
# después de cada uno (/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh, puesto para splunk).
echo "Listo: https://$DOMAIN"
