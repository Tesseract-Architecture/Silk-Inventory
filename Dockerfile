# ---- build ----
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web/package*.json web/
RUN npm --prefix web ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=America/Argentina/Buenos_Aires DATA_DIR=/data PORT=8080
# Qué versión está corriendo (lo pasa deploy/update.sh): la app lo compara con GitHub.
ARG GIT_COMMIT=desconocido
ARG BUILD_DATE=
ENV GIT_COMMIT=$GIT_COMMIT BUILD_DATE=$BUILD_DATE
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist
COPY package.json ./
# Sin root: el usuario "node" (uid 1000) es el mismo dueño que ./data en el server.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
