import { db, ensureCategory, ensureLocation, logMovement, nextItemCode } from '../db/db.js';
import { todayLocal } from '../lib/dates.js';
import { guessLocationKind, parseNotes, parseWorkbook, titleCase } from './parse.js';

export interface ImportOptions {
  dryRun?: boolean;
  /** Borra lo importado antes desde Excel (y sus préstamos) y vuelve a importar. */
  replace?: boolean;
  userId?: number | null;
  /** Regex de hojas a omitir. null = importar todas. */
  skipSheets?: RegExp | null;
}

export interface ImportReport {
  dryRun: boolean;
  sheets: { name: string; headerRow: number | null; columns: Record<string, string>; rows: number; layout?: string; skippedReason?: string }[];
  items: number;
  stockRules: number;
  loans: number;
  contacts: number;
  locations: number;
  warnings: string[];
}

class Rollback extends Error {}

export async function importWorkbook(file: string | Buffer, opts: ImportOptions = {}): Promise<ImportReport> {
  const sheets = await parseWorkbook(file, opts.skipSheets === undefined ? /compra|old/i : opts.skipSheets);
  const report: ImportReport = {
    dryRun: !!opts.dryRun,
    sheets: sheets.map((s) => ({
      name: s.name,
      headerRow: s.headerRow,
      columns: s.columns as Record<string, string>,
      rows: s.rows.length,
      layout: s.layout,
      skippedReason: s.skippedReason,
    })),
    items: 0,
    stockRules: 0,
    loans: 0,
    contacts: 0,
    locations: 0,
    warnings: sheets.flatMap((s) => s.warnings),
  };
  const uid = opts.userId ?? null;
  const today = todayLocal();

  const run = db.transaction(() => {
    const existing = (db.prepare("SELECT COUNT(*) AS n FROM items WHERE source LIKE 'excel:%'").get() as { n: number }).n;
    if (existing && !opts.replace) {
      throw new Error(`Ya hay ${existing} ítems importados de un Excel. Usá la opción "reemplazar" para borrarlos y volver a importar.`);
    }
    if (opts.replace) db.prepare("DELETE FROM items WHERE source LIKE 'excel:%'").run();

    const locBefore = (db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number }).n;
    const seenSerials = new Map<string, string>();
    const contactIds = new Map<string, number>();
    const findContact = db.prepare('SELECT id FROM contacts WHERE name = ? COLLATE NOCASE');
    // "lo tiene Fer" -> alguien del equipo cuyo nombre empiece así (si ya está cargado).
    const findPerson = db.prepare("SELECT id FROM users WHERE name LIKE ? || '%' COLLATE NOCASE ORDER BY id LIMIT 1");
    const insertItem = db.prepare(
      `INSERT INTO items (code, category_id, description, brand, part_number, serial_number, location_id, status,
                          kind, quantity, min_stock, box_mismatch, notes, source, assigned_to, created_by, updated_by)
       VALUES (@code, @category_id, @description, @brand, @part, @serial, @location_id, @status,
               @kind, @quantity, @min_stock, @box_mismatch, @notes, @source, @assigned_to, @uid, @uid)`,
    );

    for (const sheet of sheets) {
      for (const r of sheet.rows) {
        const where = `${r.sheet} fila ${r.rowNumber}`;
        const rootId = ensureLocation(r.location, null, guessLocationKind(r.location));
        const locationId = r.shelf ? ensureLocation(r.shelf, rootId, guessLocationKind(r.shelf) === 'otro' ? 'estante' : guessLocationKind(r.shelf)) : rootId;
        const categoryId = r.category ? ensureCategory(r.category.replace(/\s*\/\s*/g, ' / ')) : null;
        const note = parseNotes(r.notes);
        let holderId: number | null = null;
        if (note.holder) {
          holderId = (findPerson.get(note.holder) as { id: number } | undefined)?.id ?? null;
          if (!holderId) report.warnings.push(`${where}: en uso por "${note.holder}", que no está en Equipo (asignalo a mano)`);
        }

        if (r.serial) {
          const key = r.serial.toUpperCase();
          if (seenSerials.has(key)) report.warnings.push(`${where}: N° de serie ${r.serial} repetido (ya estaba en ${seenSerials.get(key)})`);
          else seenSerials.set(key, where);
        }

        const isConsumable = !r.serial && r.quantity != null && r.quantity !== 1;
        const status = note.loan ? 'prestado' : note.broken ? 'roto' : (note.status ?? 'disponible');
        const code = nextItemCode();
        const itemId = Number(
          insertItem.run({
            code,
            category_id: categoryId,
            description: r.description,
            brand: r.brand,
            part: r.part,
            serial: r.serial,
            location_id: locationId,
            status: isConsumable && note.loan ? 'disponible' : status,
            kind: isConsumable ? 'consumible' : 'unidad',
            quantity: r.quantity ?? 1,
            min_stock: r.min_stock,
            box_mismatch: note.boxMismatch ? 1 : 0,
            notes: r.notes,
            source: r.sourceId,
            assigned_to: holderId,
            uid,
          }).lastInsertRowid,
        );
        report.items++;
        logMovement(itemId, uid, 'alta', { importado: where });

        if (note.loan) {
          const name = titleCase(note.loan.who);
          let contactId = contactIds.get(name.toLowerCase()) ?? (findContact.get(name) as { id: number } | undefined)?.id;
          if (!contactId) {
            contactId = Number(db.prepare('INSERT INTO contacts (name) VALUES (?)').run(name).lastInsertRowid);
            report.contacts++;
          }
          contactIds.set(name.toLowerCase(), contactId);
          const loanedAt = note.loan.date ?? today;
          if (!note.loan.date) report.warnings.push(`${where}: préstamo a ${name} sin fecha, se tomó hoy`);
          if (note.loan.date && note.loan.date > today) report.warnings.push(`${where}: préstamo con fecha futura (${note.loan.date})`);
          db.prepare(
            'INSERT INTO loans (item_id, contact_id, quantity, loaned_at, notes, loaned_by) VALUES (?, ?, ?, ?, ?, ?)',
          ).run(itemId, contactId, 1, loanedAt, `Importado del Excel: "${r.notes}"`, uid);
          report.loans++;
        }
      }
    }
    const addRule = db.prepare('INSERT INTO model_stock (model, min_qty, notes) VALUES (?, ?, ?) ON CONFLICT(model) DO NOTHING');
    for (const rule of sheets.flatMap((s) => s.stockRules)) {
      if (addRule.run(rule.model, rule.min, rule.notes).changes) report.stockRules++;
    }

    report.locations = (db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number }).n - locBefore;
    if (opts.dryRun) throw new Rollback();
  });

  try {
    run();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return report;
}
