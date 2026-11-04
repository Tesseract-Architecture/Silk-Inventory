import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { requireAdmin, requireWrite } from '../auth/auth.js';
import { db, locationPaths, logMovement, nextItemCode } from '../db/db.js';
import { formatDateAr } from '../lib/reminders.js';

export const ITEM_STATUSES = ['disponible', 'prestado', 'reservado', 'en_uso', 'en_reparacion', 'roto', 'baja'] as const;

const nullableStr = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null);

const itemSchema = z.object({
  description: z.string().trim().min(1, 'La descripción es obligatoria'),
  category_id: z.number().int().nullish(),
  brand: nullableStr,
  part_number: nullableStr,
  serial_number: nullableStr,
  location_id: z.number().int().nullish(),
  status: z.enum(ITEM_STATUSES).default('disponible'),
  kind: z.enum(['unidad', 'consumible']).default('unidad'),
  quantity: z.number().min(0).default(1),
  unit: nullableStr,
  min_stock: z.number().min(0).nullish(),
  box_mismatch: z.boolean().default(false),
  notes: nullableStr,
  /** Alguien de Silk que lo tiene en uso (se lo llevó a un trabajo, está en su oficina). */
  assigned_to: z.number().int().nullish(),
});
type ItemInput = z.infer<typeof itemSchema>;

const ITEM_FIELDS = [
  'description', 'category_id', 'brand', 'part_number', 'serial_number', 'location_id',
  'status', 'kind', 'quantity', 'unit', 'min_stock', 'box_mismatch', 'notes', 'assigned_to',
] as const;

export interface ItemRow {
  id: number;
  code: string;
  description: string;
  category_id: number | null;
  category: string | null;
  brand: string | null;
  part_number: string | null;
  serial_number: string | null;
  location_id: number | null;
  location: string | null;
  status: string;
  kind: string;
  quantity: number;
  unit: string | null;
  min_stock: number | null;
  box_mismatch: number;
  notes: string | null;
  updated_at: string;
  assigned_to: number | null;
  assigned_name: string | null;
  loan_id: number | null;
  loan_contact: string | null;
  loan_company: string | null;
  loaned_at: string | null;
  loan_due: string | null;
  loaned_qty: number | null;
}

export function listItems(where = '1=1', params: unknown[] = []): ItemRow[] {
  const rows = db
    .prepare(
      `SELECT i.id, i.code, i.description, i.category_id, c.name AS category, i.brand, i.part_number,
              i.serial_number, i.location_id, i.status, i.kind, i.quantity, i.unit, i.min_stock,
              i.box_mismatch, i.notes, i.updated_at, i.assigned_to, au.name AS assigned_name,
              l.id AS loan_id, ct.name AS loan_contact, ct.company AS loan_company,
              l.loaned_at, l.due_date AS loan_due,
              (SELECT SUM(quantity) FROM loans WHERE item_id = i.id AND returned_at IS NULL) AS loaned_qty
         FROM items i
         LEFT JOIN categories c ON c.id = i.category_id
         LEFT JOIN users au ON au.id = i.assigned_to
         LEFT JOIN loans l ON l.id = (SELECT id FROM loans WHERE item_id = i.id AND returned_at IS NULL
                                      ORDER BY loaned_at DESC LIMIT 1)
         LEFT JOIN contacts ct ON ct.id = l.contact_id
        WHERE ${where}
        ORDER BY i.id`,
    )
    .all(...params) as ItemRow[];
  const paths = locationPaths();
  for (const r of rows) r.location = r.location_id ? paths.get(r.location_id) ?? null : null;
  return rows;
}

function serialTaken(serial: string | null, exceptId?: number) {
  if (!serial) return null;
  return db
    .prepare('SELECT id, code, description FROM items WHERE serial_number = ? COLLATE NOCASE AND id != ?')
    .get(serial, exceptId ?? 0) as { id: number; code: string; description: string } | undefined;
}

function toDb(v: ItemInput) {
  return {
    ...v,
    box_mismatch: v.box_mismatch ? 1 : 0,
    category_id: v.category_id ?? null,
    location_id: v.location_id ?? null,
    min_stock: v.min_stock ?? null,
    // Solo tiene sentido mientras está "en uso".
    assigned_to: v.status === 'en_uso' ? (v.assigned_to ?? null) : null,
  };
}

export async function itemRoutes(app: FastifyInstance) {
  app.get('/api/items', async (req) => {
    const { all } = req.query as { all?: string };
    return all === '1' ? listItems() : listItems("i.status != 'baja'");
  });

  app.get('/api/items/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [item] = listItems('i.id = ?', [id]);
    if (!item) return reply.code(404).send({ error: 'No existe el ítem' });
    const movements = db
      .prepare(
        `SELECT m.id, m.action, m.detail, m.created_at, u.name AS user FROM movements m
         LEFT JOIN users u ON u.id = m.user_id WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 200`,
      )
      .all(id);
    const loans = db
      .prepare(
        `SELECT l.*, c.name AS contact, c.company, c.phone, u.name AS loaned_by_name, r.name AS responsible_name FROM loans l
         JOIN contacts c ON c.id = l.contact_id LEFT JOIN users u ON u.id = l.loaned_by
         LEFT JOIN users r ON r.id = l.responsible_id
         WHERE l.item_id = ? ORDER BY l.loaned_at DESC, l.id DESC`,
      )
      .all(id);
    return { item, movements, loans };
  });

  app.post('/api/items', { preHandler: requireWrite }, async (req, reply) => {
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const v = toDb(parsed.data);
    const dup = serialTaken(v.serial_number);
    if (dup && !(req.body as { force?: boolean }).force) {
      return reply.code(409).send({ error: `El N° de serie ya está cargado en ${dup.code} (${dup.description})`, duplicate: dup });
    }
    const code = nextItemCode();
    const id = Number(
      db
        .prepare(
          `INSERT INTO items (code, ${ITEM_FIELDS.join(', ')}, created_by, updated_by)
           VALUES (@code, ${ITEM_FIELDS.map((f) => '@' + f).join(', ')}, @uid, @uid)`,
        )
        .run({ ...v, code, uid: req.user!.id }).lastInsertRowid,
    );
    logMovement(id, req.user!.id, 'alta', { code });
    return listItems('i.id = ?', [id])[0];
  });

  app.put('/api/items/:id', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const before = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!before) return reply.code(404).send({ error: 'No existe el ítem' });
    const parsed = itemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const v = toDb(parsed.data);
    const dup = serialTaken(v.serial_number, id);
    if (dup && !(req.body as { force?: boolean }).force) {
      return reply.code(409).send({ error: `El N° de serie ya está cargado en ${dup.code} (${dup.description})`, duplicate: dup });
    }

    const changes: Record<string, [unknown, unknown]> = {};
    for (const f of ITEM_FIELDS) {
      if ((before[f] ?? null) !== (v[f] ?? null)) changes[f] = [before[f], v[f]];
    }
    if (Object.keys(changes).length === 0) return listItems('i.id = ?', [id])[0];

    db.prepare(
      `UPDATE items SET ${ITEM_FIELDS.map((f) => `${f} = @${f}`).join(', ')}, updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
    ).run({ ...v, id, uid: req.user!.id });

    const paths = locationPaths();
    if (changes.location_id) {
      const [from, to] = changes.location_id as [number | null, number | null];
      logMovement(id, req.user!.id, 'mover', {
        from: from ? paths.get(from) : null, to: to ? paths.get(to) : null, from_id: from, to_id: to,
      });
      delete changes.location_id;
    }
    if (Object.keys(changes).length) logMovement(id, req.user!.id, 'edicion', changes);
    return listItems('i.id = ?', [id])[0];
  });

  // Ajuste de stock para consumibles (+ entrada / - salida)
  app.post('/api/items/:id/adjust', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { delta, reason } = req.body as { delta: number; reason?: string };
    if (!Number.isFinite(delta) || delta === 0) return reply.code(400).send({ error: 'Cantidad inválida' });
    const item = db.prepare('SELECT quantity FROM items WHERE id = ?').get(id) as { quantity: number } | undefined;
    if (!item) return reply.code(404).send({ error: 'No existe el ítem' });
    const quantity = Math.max(0, item.quantity + delta);
    db.prepare("UPDATE items SET quantity = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(quantity, req.user!.id, id);
    logMovement(id, req.user!.id, delta > 0 ? 'entrada' : 'salida', { delta, quantity, reason: reason || null });
    return listItems('i.id = ?', [id])[0];
  });

  app.post('/api/items/bulk-move', { preHandler: requireWrite }, async (req, reply) => {
    const { ids, location_id } = req.body as { ids: number[]; location_id: number };
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ error: 'No hay ítems seleccionados' });
    const paths = locationPaths();
    const get = db.prepare('SELECT location_id FROM items WHERE id = ?');
    const upd = db.prepare("UPDATE items SET location_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?");
    db.transaction(() => {
      for (const id of ids) {
        const cur = get.get(id) as { location_id: number | null } | undefined;
        if (!cur || cur.location_id === location_id) continue;
        upd.run(location_id, req.user!.id, id);
        logMovement(id, req.user!.id, 'mover', {
          from: cur.location_id ? paths.get(cur.location_id) : null,
          to: paths.get(location_id),
          from_id: cur.location_id,
          to_id: location_id,
        });
      }
    })();
    return { ok: true };
  });

  // "Eliminar" = dar de baja. Nunca se borra: queda el historial y se puede deshacer.
  app.delete('/api/items/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const active = db.prepare('SELECT 1 FROM loans WHERE item_id = ? AND returned_at IS NULL').get(id);
    if (active) return reply.code(409).send({ error: 'El ítem tiene un préstamo activo' });
    const item = db.prepare('SELECT status FROM items WHERE id = ?').get(id) as { status: string } | undefined;
    if (!item) return reply.code(404).send({ error: 'No existe el ítem' });
    if (item.status === 'baja') return { ok: true };
    const reason = (req.body as { reason?: string } | undefined)?.reason || null;
    db.prepare("UPDATE items SET status = 'baja', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(req.user!.id, id);
    logMovement(id, req.user!.id, 'baja', { prev_status: item.status, reason });
    return { ok: true };
  });

  app.get('/api/export.xlsx', async (_req, reply) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventario', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Código', key: 'code', width: 11 },
      { header: 'Ubicación', key: 'location', width: 32 },
      { header: 'Categoría', key: 'category', width: 22 },
      { header: 'Descripción / Modelo', key: 'description', width: 40 },
      { header: 'Marca', key: 'brand', width: 14 },
      { header: 'Part number', key: 'part_number', width: 20 },
      { header: 'N° de serie', key: 'serial_number', width: 22 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Cantidad', key: 'quantity', width: 10 },
      { header: 'Stock mín.', key: 'min_stock', width: 10 },
      { header: 'Prestado a', key: 'loan', width: 26 },
      { header: 'Desde', key: 'loaned_at', width: 12 },
      { header: 'Notas', key: 'notes', width: 40 },
    ];
    for (const i of listItems()) {
      ws.addRow({
        ...i,
        loan: i.loan_contact ? [i.loan_contact, i.loan_company].filter(Boolean).join(' - ') : '',
        loaned_at: formatDateAr(i.loaned_at),
      });
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    ws.autoFilter = { from: 'A1', to: 'M1' };
    const buf = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="inventario-${date}.xlsx"`)
      .send(Buffer.from(buf));
  });
}
