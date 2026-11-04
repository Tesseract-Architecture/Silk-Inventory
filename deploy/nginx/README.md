# Publicar el inventario en https://inventario.silk-technologies.com

Mismo esquema que Silk Pilot (`AI-VL-ecosystem/docs/PUBLIC_ACCESS.md`): el nginx de la oficina
pone el certificado real y reenvía a la VM, que tiene el suyo propio.

```
navegador ──https──▶ 201.216.197.132 ─NAT─▶ 192.168.12.102 (ticktera: nginx, Let's Encrypt)
                                                   │  solo inventario.silk-technologies.com
                                                   ▼
                                   https://<IP de la VM>:443  (Caddy, tls internal) ─▶ app:8080
```

En la oficina el DNS interno (`silk-dns`, 192.168.12.100) resuelve el nombre directo a ticktera, así
que de adentro y de afuera se entra por el mismo nombre y el mismo certificado.

## 1. La VM

Ubuntu con Docker y Docker Compose, con salida a internet (Microsoft y WhatsApp). Después, como
dice el README de la raíz:

```bash
git clone https://github.com/Tesseract-Architecture/Silk-Inventory.git inventario && cd inventario
cp .env.example .env && nano .env
docker compose up -d --build
```

En el `.env`, el nombre público en los dos lugares (el resto como dice `.env.example`):

```bash
APP_URL=https://inventario.silk-technologies.com
SITE_ADDRESS=inventario.silk-technologies.com
```

**El `Caddyfile` queda como está, con `tls internal`.** Quien saca el certificado público es
ticktera; si Caddy intentara pedirlo a Let's Encrypt fallaría, porque el 80 y el 443 públicos
llegan a ticktera, no a la VM.

Verificar desde ticktera (o cualquier PC de la oficina):

```bash
curl -sk --resolve inventario.silk-technologies.com:443:<IP de la VM> https://inventario.silk-technologies.com/healthz
# {"ok":true}
```

## 2. DNS — dos registros

- **GoDaddy** (DNS público): `A inventario → 201.216.197.132`, TTL 600 (la misma IP que `pilot` y `splunk`).
- **DNS interno** (`silk-dns`, `dnsmgmt.msc`, zona `silk-technologies.com`):
  `A inventario → 192.168.12.102`. Sin este, desde las PCs de la oficina da `ERR_NAME_NOT_RESOLVED`
  (pasó con Pilot el 2026-10-29).

Antes de seguir, `dig +short inventario.silk-technologies.com @1.1.1.1` tiene que dar 201.216.197.132:
Let's Encrypt valida por el puerto 80 público.

## 3. ticktera

Copiar esta carpeta a ticktera (o `git clone` el repo allá) y, como alguien del grupo sudo:

```bash
sudo bash install-inventario.sh <IP de la VM>
```

El script verifica que la VM conteste, saca el certificado (webroot, igual que Pilot), instala el
sitio y el snippet con la IP, corre `nginx -t` y recién ahí recarga. Si `nginx -t` falla, saca el
sitio y no recarga: pilot, splunk y zammad no se tocan. Si la VM cambia de IP, correrlo de nuevo con
la nueva.

## 4. Entra

Registro de la app como dice el README de la raíz, con la URI de redirección
`https://inventario.silk-technologies.com/auth/callback`.

## Qué hace cada cosa del proxy

| Línea | Por qué |
|---|---|
| `proxy_ssl_server_name on` + `proxy_ssl_name` | Caddy elige el certificado por SNI. Sin estas dos el handshake se corta y da **502** (probado). |
| `proxy_ssl_verify off` | El certificado de la VM es propio de Caddy, dentro de la red de la oficina. |
| `Host $host` | Caddy atiende solo el nombre de `SITE_ADDRESS`. |
| `X-Forwarded-For $remote_addr` | Se pisa lo que mande el cliente. |
| `client_max_body_size 32m` | Importar Excel acepta hasta 30 MB. |
| HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy` | La app no los manda. |
| `/api/auth/dev-login` → 404 | La app ya lo apaga sin `AUTH_DEV`; desde internet no tiene que existir nunca, ni por un `.env` mal copiado. |
| `limit_req` en `/auth/login` y `/auth/callback` | 10 por minuto por dirección, ráfagas de 10. Probado: el pedido 12 ya da 503. |

Probado el 2026-11-04 con nginx 1.28 delante de un Caddy 2 con `tls internal`: `nginx -t` bien,
llega el `Host` correcto, `dev-login` da 404, salen los cuatro encabezados y el límite corta.

**Nota:** la app registra la IP de ticktera y no la del cliente. Caddy no confía en
el `X-Forwarded-For` de ticktera y lo pisa. La app no usa la IP para nada, pero si se quiere ver en
los logs, en el `Caddyfile` va `servers { trusted_proxies static 192.168.12.102 }` en el bloque global.
