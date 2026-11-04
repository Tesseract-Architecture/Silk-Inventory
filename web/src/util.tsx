import { Badge } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { ItemStatus, Location } from './api';

export const STATUS: Record<ItemStatus, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: 'teal' },
  prestado: { label: 'Prestado', color: 'orange' },
  reservado: { label: 'Reservado', color: 'violet' },
  en_uso: { label: 'En uso', color: 'blue' },
  en_reparacion: { label: 'En reparación', color: 'yellow' },
  roto: { label: 'Roto', color: 'red' },
  baja: { label: 'Baja', color: 'gray' },
};

export const STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

export function StatusBadge({ status }: { status: ItemStatus }) {
  const s = STATUS[status] ?? { label: status, color: 'gray' };
  return (
    <Badge color={s.color} variant="light" size="sm">
      {s.label}
    </Badge>
  );
}

export const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  alta: { label: 'Alta', color: 'teal' },
  edicion: { label: 'Edición', color: 'blue' },
  mover: { label: 'Movido', color: 'grape' },
  entrada: { label: 'Entrada stock', color: 'teal' },
  salida: { label: 'Salida stock', color: 'orange' },
  prestamo: { label: 'Préstamo', color: 'orange' },
  devolucion: { label: 'Devolución', color: 'green' },
  baja: { label: 'Baja', color: 'gray' },
  deshacer: { label: 'Deshecho', color: 'red' },
};

export const LOCATION_KINDS = [
  { value: 'deposito', label: 'Depósito' },
  { value: 'armario', label: 'Armario' },
  { value: 'lab', label: 'Lab' },
  { value: 'rack', label: 'Rack' },
  { value: 'estante', label: 'Estante' },
  { value: 'otro', label: 'Otro' },
];

export const FIELD_LABELS: Record<string, string> = {
  description: 'Descripción',
  category_id: 'Categoría',
  brand: 'Marca',
  part_number: 'Part number',
  serial_number: 'N° de serie',
  location_id: 'Ubicación',
  status: 'Estado',
  kind: 'Tipo',
  quantity: 'Cantidad',
  unit: 'Unidad',
  min_stock: 'Stock mínimo',
  box_mismatch: 'Caja no corresponde',
  notes: 'Notas',
  assigned_to: 'Lo tiene',
};

/** "2026-06-30" o "2026-06-30 14:00:00" (UTC) -> "30/06/2026" */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Fecha-hora guardada en UTC por SQLite -> hora local. */
/** Fecha de un préstamo; los cargados sin fecha conocida dicen "Sin fecha". */
export function fmtLoanDate(iso: string | null | undefined, unknown?: number | boolean | null): string {
  return unknown ? 'Sin fecha' : fmtDate(iso);
}

export function fmtDateTime(sqlUtc?: string | null): string {
  if (!sqlUtc) return '';
  const d = new Date(sqlUtc.replace(' ', 'T') + (sqlUtc.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtPhone(digits?: string | null): string {
  if (!digits) return '';
  if (digits.startsWith('549') && digits.length === 13) {
    const n = digits.slice(3);
    const area = n.startsWith('11') ? 2 : 3;
    return `+54 9 ${n.slice(0, area)} ${n.slice(area, n.length - 4)}-${n.slice(-4)}`;
  }
  return '+' + digits;
}

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function notifyError(e: unknown) {
  notifications.show({ color: 'red', title: 'Error', message: (e as Error).message || String(e) });
}

export function notifyOk(message: string) {
  notifications.show({ color: 'teal', message });
}

/** ids de una ubicación y todas sus sub-ubicaciones. */
export function descendantIds(locations: Location[], rootId: number): Set<number> {
  const out = new Set<number>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const l of locations) {
      if (l.parent_id && out.has(l.parent_id) && !out.has(l.id)) {
        out.add(l.id);
        added = true;
      }
    }
  }
  return out;
}

export function locationOptions(locations: Location[]) {
  return locations.map((l) => ({ value: String(l.id), label: l.path }));
}

/** Búsqueda sin acentos ni mayúsculas. */
export function norm(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function describeDetail(action: string, detail: string | null, names?: { categories?: Map<number, string> }): string {
  if (!detail) return '';
  let d: any;
  try {
    d = JSON.parse(detail);
  } catch {
    return detail;
  }
  switch (action) {
    case 'mover':
      return `${d.from ?? 'sin ubicación'} → ${d.to ?? 'sin ubicación'}`;
    case 'prestamo':
      return `a ${d.a}${d.quantity && d.quantity !== 1 ? ` (${d.quantity})` : ''}${d.due_date ? `, devuelve ${fmtDate(d.due_date)}` : ''}`;
    case 'devolucion':
      return [d.consumed ? 'consumido' : '', d.notes].filter(Boolean).join(' · ');
    case 'entrada':
    case 'salida':
      return `${d.delta > 0 ? '+' : ''}${d.delta} → quedan ${d.quantity}${d.reason ? ` · ${d.reason}` : ''}`;
    case 'baja':
      return d.reason ?? '';
    case 'alta':
      return d.importado ? `importado (${d.importado})` : '';
    case 'deshacer':
      return `deshizo: ${ACTION_LABELS[d.action]?.label ?? d.action} (#${d.movement_id})`;
    case 'edicion':
      return Object.entries(d as Record<string, [unknown, unknown]>)
        .map(([f, [a, b]]) => {
          const n = (v: unknown) => (f === 'category_id' && typeof v === 'number' ? names?.categories?.get(v) ?? v : v);
          return `${FIELD_LABELS[f] ?? f}: ${show(n(a))} → ${show(n(b))}`;
        })
        .join(' · ');
    default:
      return typeof d === 'object' ? JSON.stringify(d) : String(d);
  }
}

function show(v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && v in STATUS) return STATUS[v as ItemStatus].label;
  return String(v);
}
