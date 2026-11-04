// Lectura del Excel viejo: detecta encabezados por nombre y arma filas normalizadas.
// No toca la base de datos (se testea aparte).
import ExcelJS from 'exceljs';
import { cleanSerial } from '../lib/serial.js';

export type Field =
  | 'id' | 'location' | 'shelf' | 'category' | 'description' | 'serial'
  | 'notes' | 'quantity' | 'brand' | 'part' | 'min_stock';

// Orden importa: se prueba de arriba hacia abajo y gana el primero que matchea.
const HEADER_RULES: [Field, RegExp][] = [
  ['min_stock', /^(stockmin|minimo|min$|stockminimo)/],
  ['serial', /(serie|serial|^sn$|^s\/?n$)/],
  ['part', /^(partnumber|pn$|numerodeparte|part$|nroparte)/],
  ['id', /^(id|nro|numero|#)$/],
  ['location', /^(ubicacion|deposito|armario|lugar|sitio|rack|sala)/],
  ['shelf', /^(estante|estanteria|posicion|slot|bandeja|cajon|nivel)/],
  ['category', /^(categoria|tipo|rubro)/],
  ['description', /^(descripcion|modelo|equipo|item|articulo|producto|nombre|detalle)/],
  ['notes', /^(nota|observacion|comentario|obs)/],
  ['quantity', /^(cantidad|cant|qty|stock|unidades)/],
  ['brand', /^(marca|fabricante|vendor)/],
];

export function normHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/n[°º]\s*/g, 'n')
    .replace(/[^a-z0-9#/]/g, '');
}

export function matchHeader(raw: string): Field | null {
  const h = normHeader(raw);
  if (!h) return null;
  for (const [field, re] of HEADER_RULES) if (re.test(h)) return field;
  return null;
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if ('error' in v) return '';
  }
  return String(v).trim();
}

export interface ParsedRow {
  sheet: string;
  rowNumber: number;
  sourceId: string;
  location: string;
  shelf: string | null;
  category: string | null;
  description: string;
  serial: string | null;
  notes: string | null;
  quantity: number | null;
  brand: string | null;
  part: string | null;
  min_stock: number | null;
}

export interface StockRule {
  model: string;
  min: number;
  notes: string | null;
}

export interface ParsedSheet {
  name: string;
  headerRow: number | null;
  columns: Partial<Record<Field, string>>;
  rows: ParsedRow[];
  skippedReason?: string;
  /** Formato especial (ej. hoja SFPs con un modelo por columna). */
  layout?: 'tabla' | 'columnas';
  stockRules: StockRule[];
  warnings: string[];
}

function toNumber(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export async function parseWorkbook(file: string | Buffer, skipSheets: RegExp | null = /compra|old/i): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  if (typeof file === 'string') await wb.xlsx.readFile(file);
  else await wb.xlsx.load(file as unknown as ArrayBuffer);

  const out: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    const sheet: ParsedSheet = { name: ws.name, headerRow: null, columns: {}, rows: [], stockRules: [], warnings: [] };
    out.push(sheet);
    if (skipSheets?.test(ws.name)) {
      sheet.skippedReason = 'Hoja omitida por nombre (compras / histórico)';
      continue;
    }

    // Buscar la fila de encabezados en las primeras 15 filas.
    let colMap = new Map<number, Field>();
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      const map = new Map<number, Field>();
      const names: Partial<Record<Field, string>> = {};
      ws.getRow(r).eachCell((cell, col) => {
        const text = cellText(cell.value);
        const f = matchHeader(text);
        if (f && ![...map.values()].includes(f)) {
          map.set(col, f);
          names[f] = text;
        }
      });
      const fields = new Set(map.values());
      if (fields.has('description') && map.size >= 2) {
        colMap = map;
        sheet.headerRow = r;
        sheet.columns = names;
        break;
      }
    }
    if (!sheet.headerRow) {
      if (!parseColumnLayout(ws, sheet)) {
        sheet.skippedReason = 'No encontré una fila de encabezados con "Descripción" / "Modelo"';
      }
      continue;
    }
    sheet.layout = 'tabla';

    // Sin columna de ubicación (ej. hoja "Lab"): la ubicación es el nombre de la hoja.
    const hasLocationCol = [...colMap.values()].includes('location');
    let lastLocation = '';
    let lastShelf = '';
    for (let r = sheet.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const v: Partial<Record<Field, string>> = {};
      for (const [col, f] of colMap) v[f] = cellText(row.getCell(col).value);
      const description = v.description || '';
      const serial = v.serial || '';
      if (!description && !serial) continue;

      // Celdas combinadas o vacías: heredar ubicación/estante de la fila anterior.
      const location = v.location || lastLocation || ws.name;
      const shelf = v.shelf || (v.location ? '' : lastShelf);
      lastLocation = location;
      lastShelf = shelf;

      sheet.rows.push({
        sheet: ws.name,
        rowNumber: r,
        sourceId: `excel:${ws.name}:${v.id || r}`,
        location: hasLocationCol ? location : ws.name,
        shelf: shelf || null,
        category: v.category || null,
        description: description || '(sin descripción)',
        serial: cleanSerial(serial),
        notes: v.notes || null,
        quantity: toNumber(v.quantity ?? ''),
        brand: v.brand || null,
        part: v.part || null,
        min_stock: toNumber(v.min_stock ?? ''),
      });
    }
  }
  return out;
}

// ---------- hojas "de costado" (ej. SFPs) ----------
//
//   fila N:    Caja 1     | Caja 1  | ... | Caja 2      |     | SFP DE USO FRECUENTE ... minimo 10
//   fila N+1:  GLC-T      | GLC-TE  | ... | SFP-10G-SR  |     | GLC-T-RGD=
//   fila N+2…: serie      | serie   | ... | serie       |     | SFP-10G-SR-S=
//
// Cada celda de serie es una unidad del modelo de su columna, ubicada en su caja.
// La columna con "mínimo N" es una lista de modelos con stock mínimo.

const SERIAL_RE = /^[A-Z0-9][A-Z0-9-]{5,}$/i;
const MODEL_RE = /^[A-Z0-9][A-Z0-9/-]{4,}$/i;

export function normModel(s: string): string {
  return s.trim().toUpperCase().replace(/=$/, '').replace(/\s+/g, '');
}

function parseColumnLayout(ws: ExcelJS.Worksheet, sheet: ParsedSheet): boolean {
  const text = (r: number, c: number) => cellText(ws.getRow(r).getCell(c).value);
  const lastCol = ws.columnCount;

  let boxRow = 0;
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !boxRow; r++) {
    let n = 0;
    for (let c = 1; c <= lastCol; c++) if (/^(caja|bandeja|cajon|gaveta)\b/i.test(text(r, c))) n++;
    if (n >= 2) boxRow = r;
  }
  if (!boxRow) return false;
  const modelRow = boxRow + 1;
  sheet.layout = 'columnas';
  sheet.headerRow = boxRow;

  for (let c = 1; c <= lastCol; c++) {
    const header = text(modelRow, c);
    const box = text(boxRow, c);
    const minMatch = header.match(/m[ií]nimo\s+(\d+)/i);

    if (minMatch) {
      // Columna de stock mínimo por modelo.
      const min = Number(minMatch[1]);
      for (let r = modelRow + 1; r <= ws.rowCount; r++) {
        const v = text(r, c);
        if (!v) continue;
        if (MODEL_RE.test(v.replace(/=$/, ''))) {
          sheet.stockRules.push({ model: normModel(v), min, notes: header });
        } else if (sheet.stockRules.length) {
          const last = sheet.stockRules[sheet.stockRules.length - 1];
          last.notes = [last.notes, v].filter(Boolean).join(' · ');
        }
      }
      continue;
    }

    if (!header) {
      for (let r = modelRow + 1; r <= ws.rowCount; r++) {
        const v = text(r, c);
        if (v) sheet.warnings.push(`${ws.name} ${ws.getColumn(c).letter}${r}: "${v}" no está debajo de ningún modelo, no se importó`);
      }
      continue;
    }

    const model = header;
    const location = ws.name;
    const shelf = box || null;
    for (let r = modelRow + 1; r <= ws.rowCount; r++) {
      const v = text(r, c);
      if (!v) continue;
      const base = {
        sheet: ws.name, rowNumber: r, location, shelf, category: 'SFP / Ópticos', description: model,
        brand: null, part: normModel(model), min_stock: null,
      };
      const loose = v.match(/^(\d+)\s+(?:m[aá]s\s+)?sueltos?/i);
      if (SERIAL_RE.test(v)) {
        sheet.rows.push({ ...base, sourceId: `excel:${ws.name}:${ws.getColumn(c).letter}${r}`, serial: cleanSerial(v), notes: null, quantity: null });
      } else if (loose) {
        sheet.rows.push({
          ...base, sourceId: `excel:${ws.name}:${ws.getColumn(c).letter}${r}`, serial: null,
          notes: `${v} (sin número de serie)`, quantity: Number(loose[1]),
        });
      } else {
        sheet.warnings.push(`${ws.name} ${ws.getColumn(c).letter}${r}: "${v}" en la columna ${model} no parece un número de serie, no se importó`);
      }
    }
  }
  return true;
}

// ---------- interpretación de las notas ----------

export interface NoteInfo {
  /** Préstamo a otra empresa ("PRESTADO A EDENOR 30/6/2026"). */
  loan: { who: string; date: string | null } | null;
  /** Alguien de Silk lo tiene en uso ("SE LO LLEVO MATI…", "LO TIENE FER…"): no es préstamo. */
  holder: string | null;
  boxMismatch: boolean;
  broken: boolean;
  /** Estado sugerido por la nota (además de prestado / roto). */
  status: 'reservado' | 'en_uso' | null;
}

const DATE_RE = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/;

function findDate(s: string): string | null {
  const m = s.match(DATE_RE);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function cleanWho(s: string): string {
  return s.replace(DATE_RE, '').replace(/\b(el|a|al)\s*\??\s*$/i, '').replace(/[\s,.?¿!-]+$/, '').trim();
}

export function parseNotes(notes: string | null): NoteInfo {
  const info: NoteInfo = { loan: null, holder: null, boxMismatch: false, broken: false, status: null };
  if (!notes) return info;
  const n = notes.trim();

  // "PRESTADO A EDENOR 30/6/2026" -> préstamo a otra empresa
  const loan = n.match(/prestad[oa]s?\s+(?:a\s+la|al|a)\s+(.+)$/i);
  if (loan) {
    const who = cleanWho(loan[1].split(/\s+(?:en|desde|para)\s+/i)[0]);
    if (who) info.loan = { who, date: findDate(n) };
  }
  // "SE LO LLEVO MATI A ? 27/10/2026", "LO TIENE FER EN LA OFICINA" -> en uso por alguien de Silk
  const holder = n.match(/(?:se\s+(?:lo|la|los|las)\s+llev[oó]|(?:lo|la|los|las)\s+tiene)\s+(\p{L}+)/iu);
  if (!info.loan && holder) info.holder = cleanWho(holder[1]) || null;

  info.boxMismatch = /caja.*no\s+(corresponde|es|coincide)|no\s+es\s+de\s+es[ea]\s+n/i.test(n);
  info.broken = /\broto\b|\brota\b|no\s+funciona|\bfallad[oa]\b|con\s+falla|quemad[oa]/i.test(n);
  if (/separad[oa]s?\s+para|reservad[oa]s?\s+para/i.test(n)) info.status = 'reservado';
  else if (info.holder || /maqueta|^est[aá]n?\s+en\b|\ben\s+el\s+(rack|lab)\b|instalad[oa]/i.test(n)) info.status = 'en_uso';
  return info;
}

export function titleCase(s: string): string {
  // "EDENOR" -> "Edenor"; respeta lo que ya viene en minúsculas/mixto.
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

export function guessLocationKind(name: string): string {
  const n = normHeader(name);
  if (n.startsWith('deposito')) return 'deposito';
  if (n.startsWith('armario')) return 'armario';
  if (n.startsWith('lab')) return 'lab';
  if (n.startsWith('rack')) return 'rack';
  if (n.startsWith('estante') || n.startsWith('caja')) return 'estante';
  return 'otro';
}
