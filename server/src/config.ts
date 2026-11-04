import path from 'node:path';

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function list(name: string): string[] {
  return env(name)
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const dataDir = path.resolve(env('DATA_DIR', './data'));

export const config = {
  port: Number(env('PORT', '8080')),
  appUrl: env('APP_URL', 'http://localhost:8080').replace(/\/$/, ''),
  dataDir,
  dbPath: path.join(dataDir, 'inventory.db'),
  waSessionDir: path.join(dataDir, 'wa-session'),
  backupDir: path.join(dataDir, 'backups'),
  sessionSecret: env('SESSION_SECRET', 'dev-secret-change-me-please-32chars!!'),
  timezone: env('TZ', 'America/Argentina/Buenos_Aires'),

  // Login de desarrollo (sin Microsoft). Nunca activarlo en el server.
  authDev: env('AUTH_DEV') === '1',

  entra: {
    tenantId: env('ENTRA_TENANT_ID'),
    clientId: env('ENTRA_CLIENT_ID'),
    clientSecret: env('ENTRA_CLIENT_SECRET'),
  },
  allowedDomains: list('ALLOWED_EMAIL_DOMAINS'),
  // Para armar el mail de la gente del equipo: nombre.apellido@<dominio>
  teamEmailDomain: env('TEAM_EMAIL_DOMAIN', list('ALLOWED_EMAIL_DOMAINS')[0] || 'silk-technologies.com'),
  adminEmails: list('ADMIN_EMAILS'),

  whatsappEnabled: env('WHATSAPP_ENABLED', '1') === '1',
};

export const isProd = process.env.NODE_ENV === 'production';
