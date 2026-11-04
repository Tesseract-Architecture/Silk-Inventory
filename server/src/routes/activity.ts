// Registro de actividad (quién hizo qué) y "Deshacer" de cada movimiento.
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/auth.js';
import { db, logMovement } from '../db/db.js';

interface Movement {
  id: number;
  item_id: number | null;
  user_id: number | null;
  action: string;
  detail: string | null;
  reverted_at: string | null;
}

export const REVERTIBLE = ['edicion', 'mover', 'entrada', 'salida', 'alta', 'baja', 'prestamo', 'devolucion'];

class Conflict extends Error {}

/** Aplica la operación inversa de un movimiento. Lanza Conflict si ya no se puede. */
function revert(m: Movement, uid: number) {
  const d = m.detail ? JSON.parse(m.detail) : {};
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(m.item_id) as Record<string, any> | undefined;
  if (!item) throw new Conflict('El ítem ya no existe');
  const touch = (sql: string, ...params: unknown[]) =>
    db.prepare(`UPDATE items SET ${sql}, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(...params, uid, item.id);
  const activeLoan = () => db.prepare('SELECT 1 FROM loans WHERE item_id = ? AND returned_at IS NULL').get(item.id);

  switch (m.action) {
    case 'edicion': {
      const changes = d as Record<string, [unknown, unknown]>;
      const changedSince = Object.entries(changes).filter(([f, [, after]]) => (item[f] ?? null) !== (after ?? null));
      if (changedSince.length) {
        throw new Conflict(`Estos campos se modificaron después: ${changedSince.map(([f]) => f).join(', ')}. Deshacé primero los cambios más nuevos.`);
      }
      const fields = Object.keys(changes);
      touch(fields.map((f) => `${f} = ?`).join(', '), ...fields.map((f) => changes[f][0] ?? null));
      return;
    }
    case 'mover':
      if (item.location_id !== (d.to_id ?? null)) throw new Conflict('El ítem se movió de nuevo después');
      touch('location_id = ?', d.from_id ?? null);
      return;
    case 'entrada':
    case 'salida':
      touch('quantity = MAX(0, quantity - ?)', Number(d.delta) || 0);
      return;
    case 'alta':
      if (activeLoan()) throw new Conflict('El ítem tiene un préstamo activo');
      touch("status = 'baja'");
      return;
    case 'baja':
      if (item.status !== 'baja') throw new Conflict('El ítem ya no está dado de baja');
      touch('status = ?', d.prev_status || 'disponible');
      return;
    case 'prestamo': {
      const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(d.loan_id) as Record<string, any> | undefined;
      if (!loan) throw new Conflict('El préstamo ya no existe');
      if (loan.returned_at) throw new Conflict('El préstamo ya fue devuelto: deshacé primero la devolución');
      db.prepare('DELETE FROM loans WHERE id = ?').run(loan.id);
      if (item.kind === 'unidad') touch("status = 'disponible'");
      else touch('quantity = quantity + ?', loan.quantity);
      return;
    }
    case 'devolucion': {
      const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(d.loan_id) as Record<string, any> | undefined;
      if (!loan) throw new Conflict('El préstamo ya no existe');
      if (!loan.returned_at) throw new Conflict('El préstamo ya figura como no devuelto');
      if (item.kind === 'unidad' && activeLoan()) throw new Conflict('El ítem se volvió a prestar después');
      db.prepare('UPDATE loans SET returned_at = NULL, returned_by = NULL WHERE id = ?').run(loan.id);
      if (item.kind === 'unidad') touch("status = 'prestado'");
      else if (!d.consumed) touch('quantity = MAX(0, quantity - ?)', loan.quantity);
      return;
    }
    default:
      throw new Conflict('Esta acción no se puede deshacer');
  }
}

export async function activityRoutes(app: FastifyInstance) {
  app.get('/api/activity', async (req) => {
    const q = req.query as { user_id?: string; action?: string; item_id?: string; from?: string; to?: string; q?: string; limit?: string };
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.user_id) (where.push('m.user_id = ?'), params.push(Number(q.user_id)));
    if (q.action) (where.push('m.action = ?'), params.push(q.action));
    if (q.item_id) (where.push('m.item_id = ?'), params.push(Number(q.item_id)));
    if (q.from) (where.push("date(m.created_at, 'localtime') >= ?"), params.push(q.from));
    if (q.to) (where.push("date(m.created_at, 'localtime') <= ?"), params.push(q.to));
    if (q.q) {
      where.push('(i.description LIKE ? OR i.code LIKE ? OR i.serial_number LIKE ? OR m.detail LIKE ?)');
      params.push(...Array(4).fill(`%${q.q}%`));
    }
    const rows = db
      .prepare(
        `SELECT m.id, m.action, m.detail, m.created_at, m.item_id, m.user_id, m.reverted_at,
                i.code, i.description, i.serial_number, u.name AS user, ur.name AS reverted_by_name
           FROM movements m LEFT JOIN items i ON i.id = m.item_id
           LEFT JOIN users u ON u.id = m.user_id LEFT JOIN users ur ON ur.id = m.reverted_by
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY m.id DESC LIMIT ?`,
      )
      .all(...params, Math.min(Number(q.limit) || 500, 5000)) as (Movement & Record<string, unknown>)[];
    return rows.map((r) => ({ ...r, revertible: !r.reverted_at && REVERTIBLE.includes(r.action) && !!r.item_id }));
  });

  app.get('/api/activity/users', async () =>
    db.prepare('SELECT DISTINCT u.id, u.name FROM movements m JOIN users u ON u.id = m.user_id ORDER BY u.name').all(),
  );

  app.post('/api/activity/:id/revert', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const m = db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as Movement | undefined;
    if (!m) return reply.code(404).send({ error: 'No existe el movimiento' });
    if (m.reverted_at) return reply.code(409).send({ error: 'Ya fue deshecho' });
    try {
      db.transaction(() => {
        revert(m, req.user!.id);
        db.prepare("UPDATE movements SET reverted_at = datetime('now'), reverted_by = ? WHERE id = ?").run(req.user!.id, id);
        logMovement(m.item_id, req.user!.id, 'deshacer', { movement_id: id, action: m.action });
      })();
      return { ok: true };
    } catch (e) {
      if (e instanceof Conflict) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });
}
