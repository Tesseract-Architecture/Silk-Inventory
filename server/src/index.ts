import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config, isProd } from './config.js';
import { authRoutes, installAuth } from './auth/auth.js';
import { itemRoutes } from './routes/items.js';
import { catalogRoutes } from './routes/catalog.js';
import { loanRoutes } from './routes/loans.js';
import { adminRoutes } from './routes/admin.js';
import { activityRoutes } from './routes/activity.js';
import { notifyRoutes } from './routes/notify.js';
import { teamRoutes } from './routes/team.js';
import { versionRoutes } from './routes/version.js';
import { initWhatsApp } from './whatsapp/client.js';
import { startScheduler } from './jobs/scheduler.js';

if (isProd && config.sessionSecret.startsWith('dev-secret')) {
  console.error('Falta SESSION_SECRET en .env');
  process.exit(1);
}
if (isProd && config.authDev) console.warn('⚠️  AUTH_DEV=1 en producción: cualquiera puede entrar sin Microsoft.');

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
  bodyLimit: 5 * 1024 * 1024,
});

await app.register(cookie, { secret: config.sessionSecret });
await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
// Encabezados de seguridad (también con acceso directo a la VM, sin pasar por el nginx de la oficina).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Mantine usa estilos inline
  "img-src 'self' data:", // QR y logos
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.addHook('onSend', async (_req, reply) => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
});

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error(err);
  // Los 4xx son errores del pedido y se pueden mostrar; los 500 quedan en el log, sin detalles hacia afuera.
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  return reply.code(500).send({ error: 'Error interno del servidor' });
});

installAuth(app);
await app.register(authRoutes);
await app.register(itemRoutes);
await app.register(catalogRoutes);
await app.register(loanRoutes);
await app.register(adminRoutes);
await app.register(activityRoutes);
await app.register(notifyRoutes);
await app.register(teamRoutes);
await app.register(versionRoutes);

app.get('/healthz', async () => ({ ok: true }));

// Frontend (web/dist). Cualquier ruta que no sea API devuelve index.html (SPA).
const webDist = path.resolve(process.env.WEB_DIST || 'web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'No encontrado' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
startScheduler(app.log);
initWhatsApp().catch((e) => app.log.error(e, 'No se pudo iniciar WhatsApp'));
