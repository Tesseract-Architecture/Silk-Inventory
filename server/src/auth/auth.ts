import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { config, isProd } from '../config.js';
import { db } from '../db/db.js';
import { normalizePhone } from '../lib/phone.js';
import { certExists, certInfo, signingKey } from './entraCert.js';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'usuario' | 'lectura';
  phone: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const SESSION_DAYS = 30;
const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.appUrl.startsWith('https://'),
  signed: true,
};

// ---------- sesiones ----------

function createSession(userId: number): string {
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))").run(
    id,
    userId,
    `+${SESSION_DAYS} days`,
  );
  return id;
}

function sessionUser(req: FastifyRequest): User | null {
  const raw = req.cookies.sid;
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  return (
    (db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.phone FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > datetime('now')`,
      )
      .get(un.value) as User | undefined) ?? null
  );
}

function login(reply: FastifyReply, email: string, name: string, oid: string | null) {
  email = email.toLowerCase();
  const isFirstUser = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
  const forceAdmin = config.adminEmails.includes(email) || isFirstUser;

  const existing = db.prepare('SELECT id, role FROM users WHERE email = ? OR (oid IS NOT NULL AND oid = ?)').get(email, oid) as
    | { id: number; role: string }
    | undefined;
  let userId: number;
  if (existing) {
    userId = existing.id;
    db.prepare(
      "UPDATE users SET email = ?, name = ?, oid = COALESCE(?, oid), last_login = datetime('now'), role = CASE WHEN ? THEN 'admin' ELSE role END WHERE id = ?",
    ).run(email, name, oid, forceAdmin ? 1 : 0, userId);
  } else {
    userId = Number(
      db
        .prepare("INSERT INTO users (oid, email, name, role, last_login) VALUES (?, ?, ?, ?, datetime('now'))")
        .run(oid, email, name, forceAdmin ? 'admin' : 'lectura').lastInsertRowid,
    );
  }
  reply.setCookie('sid', createSession(userId), { ...cookieOpts, maxAge: SESSION_DAYS * 86400 });
}

function domainAllowed(email: string): boolean {
  if (config.allowedDomains.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && config.allowedDomains.includes(domain);
}

// ---------- Microsoft Entra ID ----------

/** Cómo se autentica la app ante Entra: secreto (si hay) o certificado (data/entra). */
export function entraAuthMethod(): 'secreto' | 'certificado' | null {
  if (config.entra.clientSecret) return 'secreto';
  return certExists() ? 'certificado' : null;
}

export function entraConfigured(): boolean {
  return !!(config.entra.tenantId && config.entra.clientId && entraAuthMethod());
}

let oidcConfig: oidc.Configuration | null = null;
async function entra(): Promise<oidc.Configuration> {
  if (oidcConfig) return oidcConfig;
  const { tenantId, clientId, clientSecret } = config.entra;
  const method = entraAuthMethod();
  if (!tenantId || !clientId || !method) {
    throw new Error('Falta configurar Entra: ENTRA_TENANT_ID, ENTRA_CLIENT_ID y un secreto o un certificado');
  }
  const issuer = new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`);
  if (method === 'secreto') {
    oidcConfig = await oidc.discovery(issuer, clientId, clientSecret);
  } else {
    // private_key_jwt: Entra pide la huella del certificado en "x5t" y el endpoint de tokens como "aud".
    const { x5t } = certInfo()!;
    const auth = oidc.PrivateKeyJwt(await signingKey(), {
      [oidc.modifyAssertion]: (header, payload) => {
        header.x5t = x5t;
        payload.aud = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
      },
    });
    oidcConfig = await oidc.discovery(issuer, clientId, undefined, auth);
  }
  return oidcConfig;
}

/** Al cambiar las credenciales (ej. certificado nuevo) hay que volver a armar la configuración. */
export function resetEntra() {
  oidcConfig = null;
}

export const redirectUri = () => `${config.appUrl}/auth/callback`;

/** Traduce los errores típicos de Entra (ver la guía SSO de Silk) a algo accionable. */
export function explainEntraError(e: unknown): string {
  const msg = String((e as { error_description?: string })?.error_description ?? (e as Error)?.message ?? e);
  if (/AADSTS700027|AADSTS700024|certificate|client assertion/i.test(msg)) {
    return 'Entra no reconoce el certificado: subí el .cer de Administración → Login Microsoft a "Certificados y secretos → Certificados" del registro.';
  }
  if (/AADSTS7000215|invalid_client|client secret/i.test(msg)) {
    return 'El secreto de cliente es inválido o venció. Ojo: va la columna "Valor" del secreto, no el "Id. de secreto".';
  }
  if (/AADSTS700016|AADSTS90002|not found in the directory|tenant/i.test(msg)) {
    return 'El Client ID o el tenant no coinciden con el registro de la app en Entra.';
  }
  if (/AADSTS50011|redirect/i.test(msg)) {
    return `La URI de redirección no coincide: en Entra tiene que ser exactamente ${redirectUri()}`;
  }
  if (/AADSTS65001|consent/i.test(msg)) return 'Falta el consentimiento de administrador en Entra (Permisos de API).';
  if (/fetch failed|ENOTFOUND|ECONN/i.test(msg)) return 'El server no pudo conectarse con Microsoft (¿salida a internet?).';
  return 'No se pudo iniciar sesión con Microsoft';
}

/**
 * Verifica tenant + Client ID + credencial (secreto o certificado) pidiendo un token de aplicación.
 * No necesita ningún usuario ni permisos extra.
 */
export async function testEntra(): Promise<{ ok: boolean; message: string }> {
  if (!entraConfigured()) {
    return { ok: false, message: 'Falta ENTRA_CLIENT_ID en .env o generar el certificado (o cargar un secreto)' };
  }
  try {
    resetEntra();
    await oidc.clientCredentialsGrant(await entra(), { scope: 'https://graph.microsoft.com/.default' });
    return { ok: true, message: `Tenant, Client ID y ${entraAuthMethod()} correctos` };
  } catch (e) {
    resetEntra();
    return { ok: false, message: explainEntraError(e) };
  }
}

// ---------- guards ----------

export function requireWrite(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (req.user?.role === 'lectura') {
    reply.code(403).send({ error: 'Tu usuario es de solo ver (R): pedile a un administrador que te dé permiso para editar' });
    return;
  }
  done();
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (req.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Solo administradores' });
    return;
  }
  done();
}

// ---------- rutas ----------

/** Se registra en la raíz (index.ts) para que aplique a todas las rutas. */
export function installAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    req.user = sessionUser(req);
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && !req.user) {
      return reply.code(401).send({ error: 'No autenticado' });
    }
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => ({
    user: req.user,
    devLogin: config.authDev,
    entraConfigured: entraConfigured(),
  }));

  app.get('/auth/login', async (req, reply) => {
    const cfg = await entra();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(),
      scope: 'openid profile email',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    reply.setCookie('oidc', JSON.stringify({ codeVerifier, state, nonce }), { ...cookieOpts, maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/auth/callback', async (req, reply) => {
    const raw = req.cookies.oidc;
    const un = raw ? req.unsignCookie(raw) : null;
    if (!un?.valid || !un.value) return reply.redirect('/login?error=' + encodeURIComponent('La sesión de login expiró, probá de nuevo'));
    const { codeVerifier, state, nonce } = JSON.parse(un.value);
    reply.clearCookie('oidc', { path: '/' });

    try {
      const cfg = await entra();
      const tokens = await oidc.authorizationCodeGrant(cfg, new URL(req.url, config.appUrl), {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      const claims = tokens.claims()!;
      const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
      const name = String(claims.name || email);
      if (!email) throw new Error('Microsoft no devolvió el email del usuario');
      if (!domainAllowed(email)) {
        return reply.redirect('/login?error=' + encodeURIComponent(`La cuenta ${email} no pertenece a la empresa`));
      }
      login(reply, email, name, String(claims.oid || claims.sub));
      return reply.redirect('/');
    } catch (e) {
      req.log.error(e, 'Error en login Microsoft');
      return reply.redirect('/login?error=' + encodeURIComponent(explainEntraError(e)));
    }
  });

  app.post('/api/auth/dev-login', async (req, reply) => {
    if (!config.authDev) return reply.code(404).send({ error: 'No disponible' });
    const { email, name } = (req.body ?? {}) as { email?: string; name?: string };
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'Email inválido' });
    login(reply, email, name || email.split('@')[0], null);
    return { ok: true };
  });

  // El WhatsApp propio, donde llegan los recordatorios de los préstamos a cargo.
  app.put('/api/me', async (req, reply) => {
    const raw = String((req.body as { phone?: string } | undefined)?.phone ?? '').trim();
    const phone = raw ? normalizePhone(raw) : null;
    if (raw && !phone) return reply.code(400).send({ error: 'El número no parece válido (ej: 11 1234-5678)' });
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.user!.id);
    return { phone };
  });

  // Lista para elegir responsable de un préstamo.
  app.get('/api/users', async () =>
    db.prepare("SELECT id, name, email, phone IS NOT NULL AS has_phone FROM users ORDER BY name").all(),
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies.sid;
    const un = raw ? req.unsignCookie(raw) : null;
    if (un?.valid && un.value) db.prepare('DELETE FROM sessions WHERE id = ?').run(un.value);
    reply.clearCookie('sid', { path: '/' });
    let redirect = '/login';
    if (!config.authDev && config.entra.tenantId && isProd) {
      try {
        redirect = oidc.buildEndSessionUrl(await entra(), { post_logout_redirect_uri: `${config.appUrl}/login` }).href;
      } catch {
        /* sin end-session: volver al login */
      }
    }
    return { redirect };
  });

  // Limpieza de sesiones vencidas
  setInterval(() => db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run(), 3600_000).unref();
}
