import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireWrite } from '../auth/auth.js';
import { db, getSettings, logMovement } from '../db/db.js';
import { todayLocal } from '../lib/dates.js';
import { normalizePhone } from '../lib/phone.js';
import { daysBetween, isOverdue, shouldRemind } from '../lib/reminders.js';
import { activeLoans, reminderMessage, resolveTarget, sendLoanReminder } from '../jobs/reminders.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');

const createSchema = z.object({
  item_ids: z.array(z.number().int()).min(1, 'Elegí al menos un ítem'),
  contact_id: z.number().int().nullish(),
  new_contact: z
    .object({ name: z.string().trim().min(1), company: z.string().trim().nullish(), phone: z.string().trim().nullish() })
    .nullish(),
  quantity: z.number().positive().nullish(),
  loaned_at: dateStr,
  /** No se sabe cuándo se prestó: `loaned_at` es el día en que se cargó. */
  date_unknown: z.boolean().default(false),
  due_date: dateStr.nullish(),
  notes: z.string().trim().nullish(),
  reminder_every_days: z.number().int().positive().nullish(),
  /** Quién de la empresa recibe los recordatorios. Por defecto, el que carga el préstamo. */
  responsible_id: z.number().int().nullish(),
});

const updateSchema = z.object({
  loaned_at: dateStr,
  date_unknown: z.boolean().default(false),
  due_date: dateStr.nullish(),
  notes: z.string().trim().nullish(),
  reminders_paused: z.boolean(),
  reminder_every_days: z.number().int().positive().nullish(),
  responsible_id: z.number().int().nullish(),
});

function loanList(where: string, params: unknown[] = []) {
  const s = getSettings();
  const today = todayLocal();
  const rows = db
    .prepare(
      `SELECT l.*, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
              i.code AS item_code, i.description AS item_description, i.serial_number, i.kind AS item_kind,
              ub.name AS loaned_by_name, ur.name AS returned_by_name,
              resp.name AS responsible_name, resp.phone AS responsible_phone
         FROM loans l JOIN contacts c ON c.id = l.contact_id JOIN items i ON i.id = l.item_id
         LEFT JOIN users ub ON ub.id = l.loaned_by LEFT JOIN users ur ON ur.id = l.returned_by
         LEFT JOIN users resp ON resp.id = l.responsible_id
        WHERE ${where} ORDER BY l.returned_at IS NOT NULL, l.loaned_at DESC, l.id DESC`,
    )
    .all(...params) as Record<string, any>[];
  const fallback = resolveTarget(s.internal_alert_jid);
  for (const l of rows) l.remind_to = l.responsible_phone || fallback;
  return rows.map((l) => ({
    ...l,
    days: daysBetween(l.loaned_at, l.returned_at?.slice(0, 10) ?? today),
    overdue: isOverdue(l as any, today),
    remind_today: shouldRemind(l as any, s, today),
  }));
}

export async function loanRoutes(app: FastifyInstance) {
  app.get('/api/loans', async (req) => {
    const { status } = req.query as { status?: string };
    if (status === 'all') return loanList('1=1');
    if (status === 'returned') return loanList('l.returned_at IS NOT NULL');
    return loanList('l.returned_at IS NULL');
  });

  app.post('/api/loans', { preHandler: requireWrite }, async (req, reply) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    const v = p.data;
    const uid = req.user!.id;

    try {
      const ids = db.transaction(() => {
        let contactId = v.contact_id ?? null;
        if (!contactId && v.new_contact) {
          const dup = db
            .prepare('SELECT name FROM contacts WHERE lower(trim(name)) = lower(trim(?))')
            .get(v.new_contact.name) as { name: string } | undefined;
          if (dup) throw new Error(`Ya existe la empresa "${dup.name}": elegila en "Empresa existente"`);
          const phone = v.new_contact.phone ? normalizePhone(v.new_contact.phone) : null;
          if (v.new_contact.phone && !phone) throw new Error('El teléfono no parece válido (ej: 11 1234-5678)');
          contactId = Number(
            db
              .prepare('INSERT INTO contacts (name, company, phone) VALUES (?, ?, ?)')
              .run(v.new_contact.name, v.new_contact.company || null, phone).lastInsertRowid,
          );
        }
        if (!contactId) throw new Error('Elegí a quién se presta');

        const created: number[] = [];
        for (const itemId of v.item_ids) {
          const item = db.prepare('SELECT id, code, description, kind, quantity, status FROM items WHERE id = ?').get(itemId) as
            | { id: number; code: string; description: string; kind: string; quantity: number; status: string }
            | undefined;
          if (!item) throw new Error(`No existe el ítem ${itemId}`);
          let qty = 1;
          if (item.kind === 'unidad') {
            const busy = db.prepare('SELECT 1 FROM loans WHERE item_id = ? AND returned_at IS NULL').get(itemId);
            if (busy || item.status === 'prestado') throw new Error(`${item.code} (${item.description}) ya está prestado`);
            if (item.status === 'baja') throw new Error(`${item.code} está dado de baja`);
            db.prepare("UPDATE items SET status = 'prestado', updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(uid, itemId);
          } else {
            qty = v.quantity ?? 1;
            if (qty > item.quantity) throw new Error(`No hay suficiente stock de ${item.description} (hay ${item.quantity})`);
            db.prepare("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(qty, uid, itemId);
          }
          const loanId = Number(
            db
              .prepare(
                `INSERT INTO loans (item_id, contact_id, quantity, loaned_at, date_unknown, due_date, notes, reminder_every_days, loaned_by, responsible_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                itemId, contactId, qty, v.loaned_at, v.date_unknown ? 1 : 0, v.due_date ?? null, v.notes || null, v.reminder_every_days ?? null, uid,
                v.responsible_id === undefined ? uid : v.responsible_id,
              )
              .lastInsertRowid,
          );
          const contact = db.prepare('SELECT name, company FROM contacts WHERE id = ?').get(contactId) as { name: string; company: string | null };
          logMovement(itemId, uid, 'prestamo', {
            loan_id: loanId,
            a: [contact.name, contact.company].filter(Boolean).join(' - '),
            quantity: qty,
            due_date: v.due_date ?? null,
          });
          created.push(loanId);
        }
        return created;
      })();
      return loanList(`l.id IN (${ids.map(() => '?').join(',')})`, ids);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.put('/api/loans/:id', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const p = updateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    const v = p.data;
    db.prepare(
      'UPDATE loans SET loaned_at = ?, date_unknown = ?, due_date = ?, notes = ?, reminders_paused = ?, reminder_every_days = ?, responsible_id = ? WHERE id = ?',
    ).run(v.loaned_at, v.date_unknown ? 1 : 0, v.due_date ?? null, v.notes || null, v.reminders_paused ? 1 : 0, v.reminder_every_days ?? null, v.responsible_id ?? null, id);
    return loanList('l.id = ?', [id])[0];
  });

  app.post('/api/loans/:id/return', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { returned_at?: string; notes?: string; consumed?: boolean };
    const loan = db.prepare('SELECT l.*, i.kind FROM loans l JOIN items i ON i.id = l.item_id WHERE l.id = ?').get(id) as
      | { item_id: number; quantity: number; returned_at: string | null; kind: string; notes: string | null }
      | undefined;
    if (!loan) return reply.code(404).send({ error: 'No existe el préstamo' });
    if (loan.returned_at) return reply.code(409).send({ error: 'Ya estaba devuelto' });
    const uid = req.user!.id;
    const returnedAt = body.returned_at && /^\d{4}-\d{2}-\d{2}$/.test(body.returned_at) ? body.returned_at : todayLocal();

    db.transaction(() => {
      const notes = [loan.notes, body.notes?.trim() ? `Devolución: ${body.notes.trim()}` : null].filter(Boolean).join('\n') || null;
      db.prepare('UPDATE loans SET returned_at = ?, returned_by = ?, notes = ? WHERE id = ?').run(returnedAt, uid, notes, id);
      if (loan.kind === 'unidad') {
        db.prepare("UPDATE items SET status = 'disponible', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND status = 'prestado'").run(uid, loan.item_id);
      } else if (!body.consumed) {
        db.prepare("UPDATE items SET quantity = quantity + ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(loan.quantity, uid, loan.item_id);
      }
      logMovement(loan.item_id, uid, 'devolucion', { loan_id: id, consumed: !!body.consumed, notes: body.notes || null });
    })();
    return loanList('l.id = ?', [id])[0];
  });

  app.get('/api/loans/:id/message', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const loan = activeLoans().find((l) => l.id === id);
    if (!loan) return reply.code(404).send({ error: 'Préstamo no activo' });
    return { message: reminderMessage(loan), to: loan.remind_to, responsible: loan.responsible_phone ? loan.responsible_name : null };
  });

  app.post('/api/loans/:id/remind', { preHandler: requireWrite }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const loan = activeLoans().find((l) => l.id === id);
    if (!loan) return reply.code(404).send({ error: 'Préstamo no activo' });
    try {
      await sendLoanReminder(loan, req.user!.id, (req.body as { message?: string } | undefined)?.message);
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get('/api/notifications', async (req) => {
    const { loan_id } = req.query as { loan_id?: string };
    return db
      .prepare(
        `SELECT n.*, u.name AS sent_by_name FROM notifications n LEFT JOIN users u ON u.id = n.sent_by
         ${loan_id ? 'WHERE n.loan_id = ?' : ''} ORDER BY n.id DESC LIMIT 300`,
      )
      .all(...(loan_id ? [Number(loan_id)] : []));
  });
}
