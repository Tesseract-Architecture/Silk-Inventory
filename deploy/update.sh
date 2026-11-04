#!/bin/bash
# Actualiza el inventario a la última versión de GitHub. En la VM:
#     bash ~/inventario/deploy/update.sh
# Los datos (data/) y el .env no se tocan. Antes de reconstruir hace un backup de la base.
set -euo pipefail
cd "$(dirname "$0")/.."

before=$(git rev-parse --short HEAD)
git pull --ff-only
after=$(git rev-parse --short HEAD)

# Backup de la base por las dudas (si la app está corriendo).
docker compose exec -T app node --input-type=module -e \
  'const b = await import("/app/dist/jobs/backup.js"); console.log("Backup:", await b.backupNow("antes-de-actualizar"));' \
  2>/dev/null || echo "(no se pudo hacer el backup previo: la app no estaba corriendo)"

export GIT_COMMIT=$(git rev-parse HEAD)
export BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker compose up -d --build
docker image prune -f >/dev/null

echo
if [ "$before" = "$after" ]; then
  echo "Ya estaba en la última versión ($after); se reconstruyó igual."
else
  echo "Actualizado de $before a $after:"
  git log --oneline "$before..$after"
fi
