import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { migrations } from './migrations.js';

export type DB = Database.Database;

/** Archivo que deja "Restaurar backup": se pone en lugar de la base al arrancar. */
export const RESTORE_PENDING = path.join(config.dataDir, 'restore-pending.db');

export function openDb(file = config.dbPath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  if (file === config.dbPath && fs.existsSync(RESTORE_PENDING)) {
    for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    fs.renameSync(RESTORE_PENDING, file);
    console.log('Base restaurada desde backup');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export const db = openDb();

// ---------- auditoría ----------

export function logMovement(itemId: number | null, userId: number | null, action: string, detail?: unknown) {
  db.prepare('INSERT INTO movements (item_id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    itemId,
    userId,
    action,
    detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}

// ---------- settings ----------

export const defaultSettings = {
  reminder_first_after_days: 7,
  reminder_every_days: 7,
  reminder_hour: 10,
  reminder_weekdays_only: true,
  // Le llega al responsable del préstamo (alguien de la empresa) para que lo reclame.
  reminder_template:
    'Hola {nombre}! Recordatorio: {item}{serie} está prestado a {quien} desde el {fecha} ({dias} días).{vence} ¿Lo reclamamos?',
  // Número o grupo interno: destino por defecto de los resúmenes y de los préstamos sin responsable.
  internal_alert_jid: '',
  // Préstamos sin responsable (o sin WhatsApp) → destino interno: qué día. 0 = todos los días, 1..7 = lunes..domingo.
  internal_weekday: 1,
  // 1) A cada responsable, sus préstamos para reclamar. weekday: 0 = todos los días (usa "repetir cada"), 1..7 = ese día.
  individual_enabled: true,
  individual_weekday: 1,
  // 2) Resumen de todo lo prestado. weekday: 0 = todos los días, 1..7 = lunes..domingo. to vacío = interno.
  loans_summary_enabled: true,
  loans_summary_to: '',
  loans_summary_weekday: 1,
  // 3) Alerta de stock mínimo (separada).
  stock_alert_enabled: true,
  stock_alert_to: '',
  stock_alert_weekday: 1,
};
export type Settings = typeof defaultSettings;

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...defaultSettings };
  for (const r of rows) {
    if (r.key in defaultSettings) s[r.key] = JSON.parse(r.value);
  }
  return s as Settings;
}

export function saveSettings(patch: Partial<Settings>) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in defaultSettings && v !== undefined) stmt.run(k, JSON.stringify(v));
    }
  })();
}

// ---------- helpers ----------

export function nextItemCode(): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(code, 5) AS INTEGER)) AS n FROM items WHERE code LIKE 'INV-%'").get() as {
    n: number | null;
  };
  return 'INV-' + String((row.n ?? 0) + 1).padStart(5, '0');
}

/** Ruta completa de una ubicación: "Depósito 1 › Estante 2". */
export function locationPaths(): Map<number, string> {
  const rows = db.prepare('SELECT id, name, parent_id FROM locations').all() as {
    id: number;
    name: string;
    parent_id: number | null;
  }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<number, string>();
  const resolve = (id: number, depth = 0): string => {
    if (out.has(id)) return out.get(id)!;
    const r = byId.get(id);
    if (!r) return '';
    const p = r.parent_id && depth < 10 ? resolve(r.parent_id, depth + 1) : '';
    const full = p ? `${p} › ${r.name}` : r.name;
    out.set(id, full);
    return full;
  };
  for (const r of rows) resolve(r.id);
  return out;
}

/** Busca o crea una ubicación por nombre bajo un padre. */
export function ensureLocation(name: string, parentId: number | null, kind: string): number {
  const found = db
    .prepare('SELECT id FROM locations WHERE name = ? COLLATE NOCASE AND IFNULL(parent_id, 0) = IFNULL(?, 0)')
    .get(name, parentId) as { id: number } | undefined;
  if (found) return found.id;
  return Number(
    db.prepare('INSERT INTO locations (name, parent_id, kind) VALUES (?, ?, ?)').run(name, parentId, kind).lastInsertRowid,
  );
}

export function ensureCategory(name: string): number {
  const found = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name) as
    | { id: number }
    | undefined;
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(name).lastInsertRowid);
}
