// Equipo de Silk: son los usuarios de la app. Se pueden cargar antes de que entren por primera vez
// (el mail nombre.apellido@dominio los vincula cuando inician sesión con Microsoft).
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/db.js';
import { normalizePhone } from '../lib/phone.js';
import { emailFromName } from '../lib/team.js';

const ROLES = ['admin', 'usuario', 'lectura'];

/**
 * Usuarios activos del tenant vía Microsoft Graph (client credentials).
 * Requiere en la app de Entra el permiso de aplicación User.Read.All con consentimiento de administrador.
 */
async function fetchDirectoryUsers(): Promise<{ name: string; email: string; mobilePhone: string | null }[]> {
  const { tenantId, clientId, clientSecret } = config.entra;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Falta configurar la app de Microsoft (ENTRA_TENANT_ID / CLIENT_ID / CLIENT_SECRET)');
  }
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!token.access_token) throw new Error(`Microsoft no dio acceso: ${token.error_description ?? tokenRes.status}`);

  const domains = config.allowedDomains.length ? config.allowedDomains : [config.teamEmailDomain];
  const out: { name: string; email: string; mobilePhone: string | null }[] = [];
  let url: string | undefined =
    'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,mobilePhone,accountEnabled,userType&$top=999';
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const page = (await res.json()) as {
      value?: { displayName: string; mail: string | null; userPrincipalName: string; mobilePhone: string | null; accountEnabled: boolean; userType: string }[];
      '@odata.nextLink'?: string;
      error?: { message: string };
    };
    if (!res.ok || !page.value) {
      throw new Error(
        res.status === 403
          ? 'La app de Microsoft no tiene permiso para leer usuarios: falta User.Read.All con consentimiento del administrador'
          : `Error de Microsoft: ${page.error?.message ?? res.status}`,
      );
    }
    for (const u of page.value) {
      const email = (u.mail || u.userPrincipalName || '').toLowerCase();
      // Solo cuentas activas, internas y del dominio de la empresa (no invitados ni buzones raros).
      if (!u.accountEnabled || u.userType === 'Guest' || !domains.includes(email.split('@')[1])) continue;
      out.push({ name: u.displayName || email, email, mobilePhone: u.mobilePhone });
    }
    url = page['@odata.nextLink'];
  }
  return out;
}

interface PersonInput {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: string;
}

function validate(b: PersonInput, partial: boolean): { error: string } | { name?: string; email?: string; phone?: string | null; role?: string } {
  const out: { name?: string; email?: string; phone?: string | null; role?: string } = {};
  if (b.name !== undefined || !partial) {
    const name = String(b.name ?? '').trim();
    if (!name) return { error: 'Falta el nombre' };
    out.name = name;
  }
  if (b.email !== undefined || !partial) {
    const email = String(b.email ?? '').trim().toLowerCase() || (out.name ? emailFromName(out.name) : '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Mail inválido' };
    out.email = email;
  }
  if (b.phone !== undefined) {
    const raw = String(b.phone ?? '').trim();
    const phone = raw ? normalizePhone(raw) : null;
    if (raw && !phone) return { error: 'El WhatsApp no parece válido (ej: 11 1234-5678)' };
    out.phone = phone;
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return { error: 'Rol inválido' };
    out.role = b.role;
  }
  return out;
}

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/team', async () => ({
    domain: config.teamEmailDomain,
    people: db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.last_login,
                (SELECT COUNT(*) FROM loans l WHERE l.responsible_id = u.id AND l.returned_at IS NULL) AS active_loans
           FROM users u ORDER BY u.name`,
      )
      .all(),
  }));

  app.post('/api/team', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'Solo administradores' });
    const v = validate((req.body ?? {}) as PersonInput, false);
    if ('error' in v) return reply.code(400).send(v);
    const exists = db.prepare('SELECT name FROM users WHERE email = ?').get(v.email) as { name: string } | undefined;
    if (exists) return reply.code(409).send({ error: `Ya existe ${exists.name} con el mail ${v.email}` });
    const id = db
      .prepare('INSERT INTO users (name, email, phone, role) VALUES (?, ?, ?, ?)')
      .run(v.name, v.email, v.phone ?? null, v.role ?? 'usuario').lastInsertRowid;
    return { id: Number(id) };
  });

  // Admin edita todo; cada uno puede editar su propio WhatsApp.
  app.put('/api/team/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as PersonInput;
    const isAdmin = req.user!.role === 'admin';
    if (!isAdmin && (id !== req.user!.id || Object.keys(body).some((k) => k !== 'phone'))) {
      return reply.code(403).send({ error: 'Solo administradores' });
    }
    const v = validate(body, true);
    if ('error' in v) return reply.code(400).send(v);
    if (v.role && id === req.user!.id && v.role !== 'admin') {
      return reply.code(400).send({ error: 'No te podés sacar el rol de admin a vos mismo' });
    }
    if (v.email) {
      const other = db.prepare('SELECT name FROM users WHERE email = ? AND id != ?').get(v.email, id) as { name: string } | undefined;
      if (other) return reply.code(409).send({ error: `Ese mail ya es de ${other.name}` });
    }
    const fields = Object.keys(v) as (keyof typeof v)[];
    if (fields.length) {
      db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...v, id });
    }
    return { ok: true };
  });

  // Trae la gente del directorio de Microsoft (Entra ID). Agrega a los que faltan y completa el
  // WhatsApp con el celular del perfil de Microsoft 365 solo si acá no hay uno cargado.
  app.post('/api/team/sync-microsoft', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'Solo administradores' });
    try {
      const people = await fetchDirectoryUsers();
      const findByEmail = db.prepare('SELECT id, phone FROM users WHERE email = ?');
      const insert = db.prepare('INSERT INTO users (name, email, phone, role) VALUES (?, ?, ?, ?)');
      const fillPhone = db.prepare('UPDATE users SET phone = ? WHERE id = ? AND phone IS NULL');
      let added = 0;
      let phones = 0;
      db.transaction(() => {
        for (const p of people) {
          const phone = p.mobilePhone ? normalizePhone(p.mobilePhone) : null;
          const existing = findByEmail.get(p.email) as { id: number; phone: string | null } | undefined;
          if (!existing) {
            insert.run(p.name, p.email, phone, 'usuario');
            added++;
          } else if (phone && !existing.phone && fillPhone.run(phone, existing.id).changes) {
            phones++;
          }
        }
      })();
      return { found: people.length, added, phones };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // Solo se puede borrar a quien nunca entró y no tiene historial; si no, conviene dejarlo en "solo lectura".
  app.delete('/api/team/:id', async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'Solo administradores' });
    const id = Number((req.params as { id: string }).id);
    const u = db.prepare('SELECT last_login FROM users WHERE id = ?').get(id) as { last_login: string | null } | undefined;
    if (!u) return reply.code(404).send({ error: 'No existe' });
    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM loans WHERE responsible_id = ? OR loaned_by = ? OR returned_by = ?)
              + (SELECT COUNT(*) FROM movements WHERE user_id = ?) AS n`,
      )
      .get(id, id, id, id) as { n: number };
    if (u.last_login || used.n) {
      return reply.code(409).send({ error: 'Tiene actividad registrada: en vez de borrarlo, ponelo como "Solo lectura"' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { ok: true };
  });
}
