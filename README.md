# Inventario

App web para el inventario de la empresa. Reemplaza el Excel (Depósito, Armarios, Lab, SFPs, Racks…).

- **Inventario** con búsqueda y filtros por ubicación, categoría, estado, stock bajo y "la caja no corresponde".
- **Ubicaciones** en árbol (Depósito 1 › Estante 2, Armario 3 › Estante 2, Lab…): elegís un lugar y ves todo lo que hay adentro, incluidos sus estantes. Se puede imprimir.
- **Préstamos**: qué, a quién, desde cuándo y hasta cuándo. Recordatorios automáticos por **WhatsApp** (por defecto a los 7 días y después cada 7), o manuales con mensaje editable.
- **Stock mínimo** en consumibles, con alerta en el inicio y en un resumen diario por WhatsApp a un número o grupo interno.
- **Actividad**: quién hizo qué y cuándo (altas, ediciones, movimientos, préstamos, devoluciones, entradas y salidas de stock). Los admins pueden **deshacer** cualquier movimiento.
- **Backups** diarios automáticos (se guardan 30) y opción de **restaurar** toda la base a un día.
- **Etiquetas QR** para pegar en los equipos: al escanearlas con el celular se abre la ficha.
- Login con **Microsoft** (cuentas de la empresa). Roles: administrador, usuario y solo lectura.
- Exportar a Excel.

## Instalación en el server

Hace falta Docker (con Docker Compose).

```bash
# 1. Copiar la carpeta al server (o git clone) y entrar
cd inventario

# 2. Configurar
cp .env.example .env
nano .env            # completar APP_URL, SITE_ADDRESS, SESSION_SECRET y lo de Entra (ver abajo)

# 3. Levantar
docker compose up -d --build

# 4. Importar el Excel viejo (primero una prueba que no guarda nada)
cp /ruta/inventario.xlsx data/
docker compose exec app node dist/import/cli.js /data/inventario.xlsx --dry
docker compose exec app node dist/import/cli.js /data/inventario.xlsx
```

La importación también se puede hacer desde la app: **Administración → Importar Excel**.

Después, en **Administración → WhatsApp**, tocá **Vincular** y escaneá el QR desde el celular de la empresa
(WhatsApp → Dispositivos vinculados → Vincular un dispositivo). La sesión queda guardada en `data/wa-session`.

Todo lo que importa vive en `data/`: la base (`inventory.db`), la sesión de WhatsApp y los backups.
**Esa carpeta es la que hay que resguardar.**

### Actualizar a una versión nueva

```bash
git pull            # o copiar los archivos nuevos (sin pisar data/ ni .env)
docker compose up -d --build
```

### Restaurar un backup

Desde **Administración → Backups → Restaurar**. Antes de restaurar se guarda un backup del estado actual y la app se reinicia sola.
Para deshacer un cambio puntual no hace falta esto: usá **Actividad → Deshacer**.

## Login con Microsoft (Entra ID)

Es el mismo proceso que se usó con **Silk Pilot** (guía `SSO-Microsoft-Entra.md`). Lo hace alguien con rol
*Administrador de aplicaciones* o *Administrador global* en <https://entra.microsoft.com>:

1. **Aplicaciones → Registros de aplicaciones → + Nuevo registro** (antes, revisar en *Todas las aplicaciones* que no exista).
   - Nombre: `Inventario`.
   - Tipos de cuenta: *Solo inquilino único: Silk Tech SRL*.
   - URI de redirección: plataforma **Web** y `https://<SITE_ADDRESS>/auth/callback` (= `APP_URL` + `/auth/callback`).
     Tiene que coincidir exactamente. La app la muestra lista para copiar en **Administración → Login Microsoft**.
2. Anotar el **Id. de aplicación (cliente)** → `ENTRA_CLIENT_ID`. El tenant de Silk ya viene en `.env.example`
   (`bb8c89f1-1a6a-4f96-ada2-0f2b7f9704b3`).
3. **Certificados y secretos → + Nuevo secreto de cliente** (24 meses) → copiar la columna **Valor**
   (no el "Id. de secreto") → `ENTRA_CLIENT_SECRET`. Agendar el vencimiento.
4. **Permisos de API** → *Conceder consentimiento de administrador para Silk Tech SRL*.
5. Para el botón **Equipo → Traer de Microsoft**: en **Permisos de API** → *Agregar un permiso* → **Microsoft Graph** →
   *Permisos de aplicación* → `User.Read.All`, y conceder el consentimiento de nuevo.
6. Reiniciar (`docker compose up -d`) y en **Administración → Login Microsoft → Probar conexión** verificar que todo esté bien.
   Probar el login en una ventana de incógnito.

Los usuarios aparecen solos la primera vez que entran (o se cargan antes en **Equipo**: se vinculan por el mail).
El primero que entra y los de `ADMIN_EMAILS` quedan como admin; los demás como "usuario".

Si falla: `AADSTS50011` = la URI de redirección no coincide; `AADSTS700016` = Client ID o tenant equivocado;
si volvés de Microsoft y da error, casi siempre es el secreto (se pegó el Id. en vez del Valor, o venció).
La app muestra el motivo en la pantalla de login. Más detalle en Entra → Supervisión → Registros de inicio de sesión.

## HTTPS y acceso

Microsoft exige HTTPS para el login (salvo en `localhost`). El `docker-compose.yml` trae **Caddy** adelante de la app:

- Con un **nombre interno** (ej. `inventario.silk.local` en el DNS de la oficina): usa un certificado propio (`tls internal`).
  Los navegadores avisan la primera vez; para evitarlo se instala la CA de Caddy en las PCs
  (`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`).
- Con un **dominio público** apuntando al server: borrar `tls internal` del `Caddyfile` y Caddy saca un certificado de Let's Encrypt solo.

## WhatsApp: cómo dejarlo andando

1. Poner la SIM de la línea dedicada (por ejemplo la del router Cisco IR) en un celular, instalar **WhatsApp Business** y registrar el número con el SMS.
2. Activar la **verificación en dos pasos** (Ajustes → Cuenta) con PIN y mail de la empresa.
3. En la app: **Administración → WhatsApp → Vincular** y escanear el QR desde ese celular.
4. Sacar la SIM y volverla al router: WhatsApp sigue andando por WiFi, la SIM no hace falta (y no gasta datos).
5. Dejar el celular **enchufado y con el WiFi de la oficina**. WhatsApp desvincula los dispositivos si el celular pasa ~14 días sin conectarse;
   si eso pasa, la app muestra un aviso naranja arriba de todo y hay que volver a escanear el QR.

Si WhatsApp pide verificar el número de nuevo (reinstalación, cambio de celular), el SMS llega a la SIM: se lee desde el router
(`show cellular 0/1/0 sms` o `cellular 0/1/0 lte sms view all`, según modelo) o poniendo la SIM un rato en el celular.

## WhatsApp: a tener en cuenta

- Usa un número de WhatsApp común vinculado como "dispositivo" (como WhatsApp Web), no la API oficial de Meta.
  Es gratis, pero no es oficial: **usá un número dedicado de la empresa** y mensajes razonables (la app ya espacia los envíos y manda como mucho uno por préstamo por día).
- Si el celular se desvincula o pierde la sesión, la app lo muestra en Administración y hay que volver a escanear el QR.
- Si WhatsApp está desconectado, los recordatorios no se mandan (queda registrado) y siempre está el botón **Abrir en mi WhatsApp** que arma el mensaje en tu celular/PC.
- Los contactos importados del Excel (ej. "Edenor") vienen sin teléfono: cargalo en **Contactos** para que les lleguen los avisos.

## Configuración de recordatorios

En **Administración → Recordatorios**: días hasta el primer aviso, cada cuántos días se repite, hora de envío, solo días hábiles,
el texto del mensaje (con variables `{nombre}`, `{item}`, `{serie}`, `{fecha}`, `{dias}`…) y el número o grupo para el resumen interno diario.
Cada préstamo puede tener su propia fecha de devolución, su propia frecuencia o tener los recordatorios pausados.

## Desarrollo

```bash
npm install && npm --prefix web install
AUTH_DEV=1 npm run dev        # backend en http://localhost:8080 (login sin Microsoft)
npm run dev:web               # frontend con hot reload en http://localhost:5173
npm test                      # tests
npm run import -- archivo.xlsx --dry
```

`AUTH_DEV=1` habilita un login sin Microsoft. **Nunca** usarlo en el server.

Stack: Node 22 + TypeScript + Fastify + SQLite (better-sqlite3) · React + Mantine · Baileys (WhatsApp) · ExcelJS.
