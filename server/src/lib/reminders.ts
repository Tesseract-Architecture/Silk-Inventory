// Lógica pura de recordatorios (sin DB) para poder testearla.

export interface ReminderLoan {
  loaned_at: string; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  returned_at: string | null;
  reminders_paused: number | boolean;
  reminder_every_days: number | null;
  last_reminder_at: string | null; // YYYY-MM-DD o datetime
  /** A dónde va el recordatorio: WhatsApp del responsable (o el número/grupo interno). */
  remind_to: string | null;
}

export interface ReminderSettings {
  reminder_first_after_days: number;
  reminder_every_days: number;
}

/** Días calendario entre dos fechas YYYY-MM-DD (b - a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}

export function isOverdue(loan: Pick<ReminderLoan, 'due_date' | 'returned_at'>, today: string): boolean {
  return !loan.returned_at && !!loan.due_date && today > loan.due_date;
}

/**
 * ¿Hay que mandarle recordatorio hoy a este préstamo?
 * - Con fecha de devolución: se avisa a partir del día siguiente al vencimiento.
 * - Sin fecha: se avisa cuando lleva >= N días prestado.
 * - Después se repite cada X días (del préstamo o de la configuración general).
 * - `weekly`: los avisos salen un día fijo por semana; ese día va todo lo que ya pasó el primer aviso
 *   (sin "repetir cada"), salvo que ya se haya avisado hoy.
 */
export function shouldRemind(loan: ReminderLoan, s: ReminderSettings, today: string, weekly = false): boolean {
  if (loan.returned_at || loan.reminders_paused || !loan.remind_to) return false;

  const triggered = loan.due_date
    ? today > loan.due_date
    : daysBetween(loan.loaned_at, today) >= s.reminder_first_after_days;
  if (!triggered) return false;

  if (!loan.last_reminder_at) return true;
  if (weekly) return loan.last_reminder_at.slice(0, 10) !== today;
  const every = Math.max(1, loan.reminder_every_days ?? s.reminder_every_days);
  return daysBetween(loan.last_reminder_at.slice(0, 10), today) >= every;
}

export function formatDateAr(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Mensaje para el responsable del préstamo.
 * Variables: {nombre} (responsable), {quien} (a quién se le prestó), {item}, {serie}, {fecha}, {dias}, {vence}.
 */
export function renderReminder(
  template: string,
  v: {
    nombre: string;
    quien: string;
    item: string;
    serie: string | null;
    loaned_at: string;
    /** Sin fecha conocida: `loaned_at` es cuándo se cargó, así que los días son "por lo menos". */
    date_unknown?: boolean;
    due_date: string | null;
    today: string;
  },
): string {
  const dias = daysBetween(v.loaned_at, v.today);
  if (v.date_unknown) template = template.replace('desde el {fecha}', 'desde {fecha}');
  const vence = v.due_date
    ? v.today > v.due_date
      ? ` La devolución estaba prevista para el ${formatDateAr(v.due_date)}.`
      : ` La devolución está prevista para el ${formatDateAr(v.due_date)}.`
    : '';
  const vars: Record<string, string> = {
    nombre: v.nombre.split(' ')[0] || v.nombre,
    nombre_completo: v.nombre,
    quien: v.quien,
    item: v.item,
    serie: v.serie ? ` (S/N ${v.serie})` : '',
    fecha: v.date_unknown ? 'una fecha que no tenemos' : formatDateAr(v.loaned_at),
    dias: v.date_unknown ? `más de ${dias}` : String(dias),
    vence,
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}
