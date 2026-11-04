import { db, getSettings } from '../db/db.js';
import { localParts, todayLocal } from '../lib/dates.js';
import { daysBetween, formatDateAr, isOverdue, renderReminder, shouldRemind } from '../lib/reminders.js';
import { sendText, waState } from '../whatsapp/client.js';

export interface ActiveLoan {
  id: number;
  item_id: number;
  quantity: number;
  loaned_at: string;
  due_date: string | null;
  returned_at: string | null;
  reminders_paused: number;
  reminder_every_days: number | null;
  last_reminder_at: string | null;
  reminder_count: number;
  contact_id: number;
  contact_name: string;
  contact_company: string | null;
  contact_phone: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  responsible_phone: string | null;
  /** WhatsApp al que va el recordatorio: el del responsable o, si no tiene, el número/grupo interno. */
  remind_to: string | null;
  item_code: string;
  item_description: string;
  serial_number: string | null;
  item_kind: string;
}

export function activeLoans(): ActiveLoan[] {
  const fallback = getSettings().internal_alert_jid || null;
  const rows = db
    .prepare(
      `SELECT l.id, l.item_id, l.quantity, l.loaned_at, l.due_date, l.returned_at, l.reminders_paused,
              l.reminder_every_days, l.last_reminder_at, l.reminder_count,
              c.id AS contact_id, c.name AS contact_name, c.company AS contact_company, c.phone AS contact_phone,
              u.id AS responsible_id, u.name AS responsible_name, u.phone AS responsible_phone,
              i.code AS item_code, i.description AS item_description, i.serial_number, i.kind AS item_kind
         FROM loans l JOIN contacts c ON c.id = l.contact_id JOIN items i ON i.id = l.item_id
         LEFT JOIN users u ON u.id = l.responsible_id
        WHERE l.returned_at IS NULL ORDER BY l.loaned_at`,
    )
    .all() as ActiveLoan[];
  for (const l of rows) l.remind_to = l.responsible_phone || fallback;
  return rows;
}

export function borrowerLabel(l: { contact_name: string; contact_company: string | null }): string {
  return l.contact_company && l.contact_company.toLowerCase() !== l.contact_name.toLowerCase()
    ? `${l.contact_name} (${l.contact_company})`
    : l.contact_name;
}

function logNotification(n: {
  kind: string;
  loan_id?: number | null;
  item_id?: number | null;
  recipient: string;
  message: string;
  status: 'enviado' | 'error' | 'omitido';
  error?: string | null;
  sent_by?: number | null;
}) {
  db.prepare(
    `INSERT INTO notifications (kind, loan_id, item_id, recipient, message, status, error, sent_by)
     VALUES (@kind, @loan_id, @item_id, @recipient, @message, @status, @error, @sent_by)`,
  ).run({ loan_id: null, item_id: null, error: null, sent_by: null, ...n });
}

export function reminderMessage(loan: ActiveLoan, today = todayLocal()): string {
  const s = getSettings();
  const qty = loan.item_kind === 'consumible' && loan.quantity !== 1 ? `${loan.quantity} x ` : '';
  return renderReminder(s.reminder_template, {
    // Sin responsable el mensaje va al grupo interno: saludo genérico.
    nombre: loan.responsible_phone && loan.responsible_name ? loan.responsible_name : 'equipo',
    quien: borrowerLabel(loan),
    item: qty + loan.item_description,
    serie: loan.serial_number,
    loaned_at: loan.loaned_at,
    due_date: loan.due_date,
    today,
  });
}

/** Manda el recordatorio de un préstamo a su responsable. Lanza error si no se pudo. */
export async function sendLoanReminder(loan: ActiveLoan, userId: number | null = null, message?: string) {
  const to = loan.remind_to;
  if (!to) {
    throw new Error(
      loan.responsible_name
        ? `${loan.responsible_name} no tiene su WhatsApp cargado (y no hay número/grupo interno configurado)`
        : 'El préstamo no tiene responsable y no hay número/grupo interno configurado',
    );
  }
  const text = message?.trim() || reminderMessage(loan);
  try {
    await sendText(to, text);
  } catch (e) {
    logNotification({
      kind: 'recordatorio', loan_id: loan.id, item_id: loan.item_id, recipient: to,
      message: text, status: 'error', error: (e as Error).message, sent_by: userId,
    });
    throw e;
  }
  db.prepare("UPDATE loans SET last_reminder_at = ?, reminder_count = reminder_count + 1 WHERE id = ?").run(todayLocal(), loan.id);
  logNotification({
    kind: 'recordatorio', loan_id: loan.id, item_id: loan.item_id, recipient: to,
    message: text, status: 'enviado', sent_by: userId,
  });
}

export interface ModelStock {
  id: number;
  model: string;
  min_qty: number;
  notes: string | null;
  available: number;
}

/** Reglas de stock mínimo por modelo con lo que hay disponible de cada una. */
export function modelStock(): ModelStock[] {
  return db
    .prepare(
      `SELECT r.id, r.model, r.min_qty, r.notes,
              (SELECT COALESCE(SUM(CASE WHEN i.kind = 'consumible' THEN i.quantity ELSE 1 END), 0) FROM items i
                WHERE i.status = 'disponible'
                  AND (UPPER(REPLACE(REPLACE(IFNULL(i.part_number, ''), '=', ''), ' ', '')) = r.model
                       OR UPPER(REPLACE(REPLACE(i.description, '=', ''), ' ', '')) = r.model)) AS available
         FROM model_stock r ORDER BY r.model`,
    )
    .all() as ModelStock[];
}

export interface LowStock {
  kind: 'item' | 'modelo';
  id: number;
  code: string | null;
  description: string;
  quantity: number;
  min_stock: number;
  unit: string | null;
}

/** Consumibles bajo su mínimo + modelos con menos unidades disponibles que su mínimo. */
export function lowStockItems(): LowStock[] {
  const items = db
    .prepare(
      `SELECT 'item' AS kind, id, code, description, quantity, min_stock, unit FROM items
        WHERE min_stock IS NOT NULL AND status != 'baja' AND quantity <= min_stock ORDER BY description`,
    )
    .all() as LowStock[];
  const models = modelStock()
    .filter((r) => r.available < r.min_qty)
    .map((r) => ({ kind: 'modelo' as const, id: r.id, code: null, description: r.model, quantity: r.available, min_stock: r.min_qty, unit: 'u.' }));
  return [...items, ...models];
}

// ---------- mensajes ----------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 0 = todos los días; 1..7 = lunes..domingo. */
function dayMatches(weekday: number): boolean {
  return !weekday || localParts().weekday === WEEKDAYS[weekday - 1];
}

function isLate(l: ActiveLoan, today: string, firstAfter: number) {
  return isOverdue(l, today) || (!l.due_date && daysBetween(l.loaned_at, today) >= firstAfter);
}

function loanLine(l: ActiveLoan, today: string, firstAfter: number): string {
  const qty = l.item_kind === 'consumible' && l.quantity !== 1 ? `${l.quantity} x ` : '';
  const sn = l.serial_number ? ` (S/N ${l.serial_number})` : '';
  const due = l.due_date ? ` · devolvía ${formatDateAr(l.due_date)}` : '';
  const flag = isLate(l, today, firstAfter) ? ' ⚠️' : '';
  return `• ${qty}${l.item_description}${sn} → ${borrowerLabel(l)} · desde ${formatDateAr(l.loaned_at)} (${daysBetween(l.loaned_at, today)} días)${due}${flag}`;
}

/** Lo que le llega a un responsable: un préstamo usa la plantilla; varios, una lista. */
export function responsibleMessage(loans: ActiveLoan[], today = todayLocal()): string {
  if (loans.length === 1) return reminderMessage(loans[0], today);
  const s = getSettings();
  const first = loans[0];
  const name = first.responsible_phone && first.responsible_name ? first.responsible_name.split(' ')[0] : 'equipo';
  return [
    `Hola ${name}! Tenés ${loans.length} préstamos para reclamar:`,
    '',
    ...loans.map((l) => loanLine(l, today, s.reminder_first_after_days)),
    '',
    '¿Los reclamamos?',
  ].join('\n');
}

/** Todo lo prestado, agrupado por responsable. */
export function loansSummary(today = todayLocal()): string | null {
  const s = getSettings();
  const loans = activeLoans();
  if (!loans.length) return null;
  const late = loans.filter((l) => isLate(l, today, s.reminder_first_after_days)).length;
  const groups = new Map<string, ActiveLoan[]>();
  for (const l of loans) {
    const k = l.responsible_name ?? 'Sin responsable';
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const lines = [`📦 *Préstamos activos: ${loans.length}*${late ? ` (${late} para reclamar ⚠️)` : ''}`];
  for (const [who, ls] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push('', `*${who}* (${ls.length})`, ...ls.map((l) => loanLine(l, today, s.reminder_first_after_days)));
  }
  return lines.join('\n');
}

export function stockAlert(): string | null {
  const low = lowStockItems();
  if (!low.length) return null;
  return [
    `📉 *Bajo stock mínimo: ${low.length}*`,
    '',
    ...low.map((i) => `• ${i.description}: hay ${i.quantity}${i.unit ? ' ' + i.unit : ''} (mínimo ${i.min_stock})`),
  ].join('\n');
}

// ---------- envíos ----------

const pause = () => new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));

async function deliver(kind: string, to: string, text: string, userId: number | null, loanIds: number[] = []) {
  const ids: (number | null)[] = loanIds.length ? loanIds : [null];
  try {
    await sendText(to, text);
  } catch (e) {
    for (const id of ids) {
      logNotification({ kind, loan_id: id, recipient: to, message: text, status: 'error', error: (e as Error).message, sent_by: userId });
    }
    throw e;
  }
  for (const id of ids) logNotification({ kind, loan_id: id, recipient: to, message: text, status: 'enviado', sent_by: userId });
}

/** Un mensaje por responsable con sus préstamos. Los que no tienen a quién mandar se cuentan como omitidos. */
export async function sendToResponsibles(loans: ActiveLoan[], userId: number | null = null) {
  const r = { sent: 0, errors: 0, skipped: 0, errorMessages: [] as string[] };
  const byTarget = new Map<string, ActiveLoan[]>();
  for (const l of loans) {
    if (!l.remind_to) {
      r.skipped++;
      continue;
    }
    byTarget.set(l.remind_to, [...(byTarget.get(l.remind_to) ?? []), l]);
  }
  let first = true;
  for (const [to, ls] of byTarget) {
    if (!first) await pause();
    first = false;
    try {
      await deliver('recordatorio', to, responsibleMessage(ls), userId, ls.map((l) => l.id));
      const upd = db.prepare('UPDATE loans SET last_reminder_at = ?, reminder_count = reminder_count + 1 WHERE id = ?');
      for (const l of ls) upd.run(todayLocal(), l.id);
      r.sent++;
    } catch (e) {
      r.errors++;
      r.errorMessages.push(`${ls[0].responsible_name ?? to}: ${(e as Error).message}`);
    }
  }
  return r;
}

function destination(specific: string): string {
  return specific || getSettings().internal_alert_jid;
}

export async function sendLoansSummary(userId: number | null = null, to?: string): Promise<boolean> {
  const target = to || destination(getSettings().loans_summary_to);
  if (!target) throw new Error('No hay número o grupo configurado para el resumen de préstamos');
  await deliver('resumen_prestamos', target, loansSummary() ?? '✅ No hay nada prestado.', userId);
  return true;
}

export async function sendStockAlert(userId: number | null = null, to?: string, evenIfEmpty = true): Promise<boolean> {
  const target = to || destination(getSettings().stock_alert_to);
  if (!target) throw new Error('No hay número o grupo configurado para la alerta de stock');
  const text = stockAlert();
  if (!text && !evenIfEmpty) return false;
  await deliver('stock', target, text ?? '✅ Todo el stock está por encima del mínimo.', userId);
  return true;
}

/**
 * Lo que corre todos los días a la hora configurada. Cada parte se prende/apaga por separado:
 * - a cada responsable, sus préstamos para reclamar;
 * - resumen de todo lo prestado (todos los días o un día de la semana);
 * - alerta de stock mínimo (ídem; solo si hay algo bajo el mínimo).
 * `force` ignora el día de la semana (botón "Correr ahora").
 */
export async function runDailyReminders(opts: { force?: boolean } = {}) {
  const s = getSettings();
  const today = todayLocal();
  const result = {
    sent: 0,
    errors: 0,
    skipped: 0,
    loansSummary: false as boolean | string,
    stock: false as boolean | string,
    notes: [] as string[],
  };

  if (waState().status !== 'conectado') {
    result.notes.push('WhatsApp no está conectado; no se mandó nada');
    return result;
  }

  if (s.individual_enabled) {
    const due = activeLoans().filter((l) => shouldRemind(l, s, today));
    const r = await sendToResponsibles(due);
    Object.assign(result, { sent: r.sent, errors: r.errors, skipped: r.skipped });
    result.notes.push(...r.errorMessages);
  }

  if (s.loans_summary_enabled && (opts.force || dayMatches(s.loans_summary_weekday)) && destination(s.loans_summary_to)) {
    try {
      if (result.sent) await pause();
      result.loansSummary = await sendLoansSummary();
    } catch (e) {
      result.loansSummary = (e as Error).message;
    }
  }

  if (s.stock_alert_enabled && (opts.force || dayMatches(s.stock_alert_weekday)) && destination(s.stock_alert_to)) {
    try {
      await pause();
      result.stock = await sendStockAlert(null, undefined, false);
    } catch (e) {
      result.stock = (e as Error).message;
    }
  }
  return result;
}
