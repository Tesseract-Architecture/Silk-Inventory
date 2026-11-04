# Inventario en el nginx de la oficina (ticktera, 192.168.12.102, VLAN 12 — al lado de los
# sitios de pilot, splunk y zammad). Mismo esquema que Pilot: el puerto 80 es el sitio de
# redirección a https que ya existe (y que contesta a Let's Encrypt desde /var/www/letsencrypt);
# este sitio es solo 443.
# Se instala con install-inventario.sh (necesita sudo). El porqué de cada línea: README.md de esta carpeta.

# Login con Microsoft: como mucho 10 por minuto por dirección (ráfagas de 10).
limit_req_zone $binary_remote_addr zone=inventario_auth:10m rate=10r/m;

server {
    listen 443 ssl;
    http2 on;
    server_name inventario.silk-technologies.com;

    ssl_certificate     /etc/letsencrypt/live/inventario.silk-technologies.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/inventario.silk-technologies.com/privkey.pem;

    server_tokens off;
    client_max_body_size 32m;          # Importar Excel: la app acepta hasta 30 MB

    # La app no manda estos encabezados; los pone el proxy.
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;

    # Login de desarrollo: la app lo apaga sin AUTH_DEV, pero desde internet no tiene que existir nunca.
    location = /api/auth/dev-login { return 404; }

    location ~ ^/auth/(login|callback)$ {
        limit_req zone=inventario_auth burst=10 nodelay;
        include snippets/inventario-proxy.conf;
    }

    location / {
        include snippets/inventario-proxy.conf;
    }
}
