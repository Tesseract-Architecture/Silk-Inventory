// Ubicaciones, categorías y contactos.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireWrite } from '../auth/auth.js';
import { db, locationPaths } from '../db/db.js';
import { normalizePhone } from '../lib/phone.js';
import { normModel } from '../import/parse.js';
import { modelStock } from '../jobs/reminders.js';

const LOCATION_KINDS = ['deposito', 'armario', 'lab', 'rack', 'estante', 'otro'] as const;

const locationSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  parent_id: z.number().int().nullish(),
  kind: z.enum(LOCATION_KINDS).default('otro'),
  notes: z.string().trim().nullish(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  company: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

function isDescendant(id: number, maybeChild: number): boolean {
  let cur: number | null = maybeChild;
  for (let i = 0; cur && i < 50; i++) {
    if (cur === id) return true;
    cur = (db.prepare('SELECT parent_id FROM locations WHERE id = ?').get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null;
  }
  return false;
}

export async function catalogRoutes(app: FastifyInstance) {
  // ---------- ubicaciones ----------
  app.get('/api/locations', async () => {
    const paths = locationPaths();
    const rows = db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM items i WHERE i.location_id = l.id AND i.status != 'baja') AS item_count
         FROM locations l ORDER BY l.sort, l.name`,
      )
      .all() as { id: number; name: string }[];
    return rows
      .map((r) => ({ ...r, path: paths.get(r.id) ?? r.name }))
      .sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }));
  });

  app.post('/api/locations', { preHandler: requireWrite }, async (req, reply) => {
    const p = locationSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    try {
      const id = db
        .prepare('INSERT INTO locations (name, parent_id, kind, notes) VALUES (?, ?, ?, ?)')
        .run(p.data.name, p.data.parent_id ?? null, p.data.kind, p.data.notes ?? null).lastInsertRowid;
      return { id: Number(id) };
    } catch {
      return reply.code(409).send({ error: 'Ya existe una ubicación con ese nombre en ese lugar' });
    }
  });

  app.put('/api/locations/:id', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const p = locationSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    if (p.data.parent_id && isDescendant(id, p.data.parent_id)) {
      return reply.code(400).send({ error: 'Una ubicación no puede estar dentro de sí misma' });
    }
    try {
      db.prepare('UPDATE locations SET name = ?, parent_id = ?, kind = ?, notes = ? WHERE id = ?').run(
        p.data.name, p.data.parent_id ?? null, p.data.kind, p.data.notes ?? null, id,
      );
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'Ya existe una ubicación con ese nombre en ese lugar' });
    }
  });

  app.delete('/api/locations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM items WHERE location_id = ?').get(id) as { n: number };
    const kids = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE parent_id = ?').get(id) as { n: number };
    if (used.n || kids.n) {
      return reply.code(409).send({ error: `No se puede borrar: tiene ${used.n} ítems y ${kids.n} sub-ubicaciones` });
    }
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    return { ok: true };
  });

  // ---------- categorías ----------
  app.get('/api/categories', async () =>
    db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id AND i.status != 'baja') AS item_count
         FROM categories c ORDER BY c.name`,
      )
      .all(),
  );

  app.post('/api/categories', { preHandler: requireWrite }, async (req, reply) => {
    const name = String((req.body as { name?: string })?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio' });
    try {
      return { id: Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid) };
    } catch {
      return reply.code(409).send({ error: 'Ya existe esa categoría' });
    }
  });

  app.put('/api/categories/:id', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const name = String((req.body as { name?: string })?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio' });
    try {
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'Ya existe esa categoría' });
    }
  });

  app.delete('/api/categories/:id', { preHandler: requireAdmin }, async (req) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ---------- stock mínimo por modelo ----------
  app.get('/api/model-stock', async () => modelStock());

  const saveRule = (body: unknown) => {
    const b = (body ?? {}) as { model?: string; min_qty?: number; notes?: string };
    const model = normModel(String(b.model ?? ''));
    const min = Number(b.min_qty);
    if (!model) return { error: 'Falta el modelo' };
    if (!Number.isFinite(min) || min < 0) return { error: 'Mínimo inválido' };
    return { model, min, notes: b.notes?.trim() || null };
  };

  app.post('/api/model-stock', { preHandler: requireWrite }, async (req, reply) => {
    const r = saveRule(req.body);
    if ('error' in r) return reply.code(400).send({ error: r.error });
    try {
      db.prepare('INSERT INTO model_stock (model, min_qty, notes) VALUES (?, ?, ?)').run(r.model, r.min, r.notes);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'Ese modelo ya tiene stock mínimo' });
    }
  });

  app.put('/api/model-stock/:id', { preHandler: requireWrite }, async (req, reply) => {
    const r = saveRule(req.body);
    if ('error' in r) return reply.code(400).send({ error: r.error });
    try {
      db.prepare('UPDATE model_stock SET model = ?, min_qty = ?, notes = ? WHERE id = ?').run(
        r.model, r.min, r.notes, Number((req.params as { id: string }).id),
      );
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'Ese modelo ya tiene stock mínimo' });
    }
  });

  app.delete('/api/model-stock/:id', { preHandler: requireWrite }, async (req) => {
    db.prepare('DELETE FROM model_stock WHERE id = ?').run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ---------- contactos ----------
  app.get('/api/contacts', async () =>
    db
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM loans l WHERE l.contact_id = c.id AND l.returned_at IS NULL) AS active_loans,
           (SELECT COUNT(*) FROM loans l WHERE l.contact_id = c.id) AS total_loans
         FROM contacts c ORDER BY c.name`,
      )
      .all(),
  );

  const saveContact = (body: unknown) => {
    const p = contactSchema.safeParse(body);
    if (!p.success) return { error: p.error.issues[0].message };
    const phone = p.data.phone ? normalizePhone(p.data.phone) : null;
    if (p.data.phone && !phone) return { error: 'El teléfono no parece válido (ej: 11 1234-5678 o +54 9 11 1234 5678)' };
    return { data: { ...p.data, phone, company: p.data.company || null, email: p.data.email || null, notes: p.data.notes || null } };
  };

  app.post('/api/contacts', { preHandler: requireWrite }, async (req, reply) => {
    const r = saveContact(req.body);
    if ('error' in r) return reply.code(400).send({ error: r.error });
    const id = db
      .prepare('INSERT INTO contacts (name, company, phone, email, notes) VALUES (@name, @company, @phone, @email, @notes)')
      .run(r.data).lastInsertRowid;
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  });

  app.put('/api/contacts/:id', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = saveContact(req.body);
    if ('error' in r) return reply.code(400).send({ error: r.error });
    db.prepare('UPDATE contacts SET name = @name, company = @company, phone = @phone, email = @email, notes = @notes WHERE id = @id').run({
      ...r.data,
      id,
    });
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  });

  app.delete('/api/contacts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM loans WHERE contact_id = ?').get(id) as { n: number };
    if (used.n) return reply.code(409).send({ error: 'El contacto tiene préstamos registrados, no se puede borrar' });
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
    return { ok: true };
  });
}
