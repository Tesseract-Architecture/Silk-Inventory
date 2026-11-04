import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';

// La DB se abre al importar db.ts: apuntarla a una carpeta temporal antes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-test-'));
process.env.DATA_DIR = tmp;

const HEADERS = ['ID', 'Ubicación', 'Estante', 'Categoría', 'Descripción / Modelo', 'N° de serie', 'Notas'];

async function makeWorkbook(file: string) {
  const wb = new ExcelJS.Workbook();
  const dep = wb.addWorksheet('Depósito');
  dep.addRow(['Inventario — Depósito']);
  dep.addRow(HEADERS);
  dep.addRow([1, 'Depósito 1', 'Estante 1', 'Embalaje / Varios', 'caja pelican', '', '']);
  dep.addRow([2, 'Depósito 1', 'Estante 2', 'Networking', 'cisco isa 3000', 'FCH2627Y07L', '']);
  dep.addRow([9, 'Depósito 1', 'Estante 3', 'Networking', 'C9200L-24P-4X-E', 'JAE24261SD2', 'la caja no es de ese numero de serie']);
  dep.addRow([10, 'Depósito 1', 'Estante 4', 'Networking', 'ASR-920-12SZ-IM V01', 'FOC2707R4X6', 'esta roto']);
  dep.addRow([16, 'Depósito 2', 'Estante 1', 'Embalaje / Varios', 'film', '', 'ya casi no hay mas']);
  const arm = wb.addWorksheet('Armarios');
  arm.addRow(HEADERS);
  arm.addRow([24, 'Armario 3', 'Estante 2', 'AV / Video', 'cisco touch10 ttc5-09', 'FOC2002NERH', 'PRESTADO A EDENOR 30/6/2026']);
  arm.addRow([25, 'Armario 3', 'Estante 2', 'AV / Video', 'tortuga collab cp 8831', 'FCH2049202U', '']);
  const lab = wb.addWorksheet('Lab');
  lab.addRow(['ID', 'Estante', 'Categoría', 'Descripción / Modelo', 'N° de serie', 'Cantidad']);
  lab.addRow([1, 'Mesa', 'Networking', 'switch lab', 'FCH2049202U', 1]);
  // Hoja "de costado": un modelo por columna, series debajo, y una columna de mínimos.
  const sfp = wb.addWorksheet('SFPs');
  sfp.addRow(['Inventario — SFPs']);
  sfp.addRow(['Caja 1', 'Caja 1', 'Caja 2']);
  sfp.addRow(['GLC-TE', 'GLC-LX-SM-RGD', 'SFP-10G-SR-S', null, 'SFP DE USO FRECUENTE minimo 10 en stock']);
  sfp.addRow(['MTC16400642', 'SACW28051CZ1', 'AVD1946D5KE', null, 'GLC-LX-SM-RGD=']);
  sfp.addRow(['MTC164005GQ', '8 mas sueltos', null, 'separado para pau', 'SFP-10G-SR-I=']);
  sfp.addRow([null, null, null, null, 'no tenemos sin usar']);
  const compras = wb.addWorksheet('Compras SFP');
  compras.addRow(['Fecha', 'Descripción', 'Cantidad']);
  compras.addRow(['2026-01-01', 'SFP-10G-SR', 10]);
  await wb.xlsx.writeFile(file);
}

describe('importWorkbook', () => {
  const file = path.join(tmp, 'test.xlsx');
  beforeAll(() => makeWorkbook(file));

  it('importa ubicaciones, préstamos, flags y advierte series repetidas', async () => {
    const { importWorkbook } = await import('../src/import/excel.js');
    const { db, locationPaths } = await import('../src/db/db.js');
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

    const dry = await importWorkbook(file, { dryRun: true });
    expect(dry.items).toBe(13);
    expect(count('SELECT COUNT(*) n FROM items')).toBe(0);

    const r = await importWorkbook(file);
    expect(r.items).toBe(13);
    expect(r.stockRules).toBe(2);
    expect(r.warnings.some((w) => w.includes('separado para pau'))).toBe(true);
    expect(r.loans).toBe(1);
    expect(r.contacts).toBe(1);
    expect(r.sheets.find((s) => s.name === 'Compras SFP')?.skippedReason).toBeTruthy();
    expect(r.warnings.some((w) => w.includes('FCH2049202U'))).toBe(true);

    const paths = [...locationPaths().values()];
    expect(paths).toContain('Depósito 1 › Estante 2');
    expect(paths).toContain('Armario 3 › Estante 2');
    expect(paths).toContain('Lab › Mesa');

    const touch = db.prepare("SELECT * FROM items WHERE serial_number = 'FOC2002NERH'").get() as { id: number; status: string };
    expect(touch.status).toBe('prestado');
    const loan = db.prepare('SELECT l.*, c.name FROM loans l JOIN contacts c ON c.id = l.contact_id').get();
    expect(loan).toMatchObject({ item_id: touch.id, loaned_at: '2026-06-30', name: 'Edenor' });
    expect(count("SELECT box_mismatch n FROM items WHERE serial_number = 'JAE24261SD2'")).toBe(1);
    expect((db.prepare("SELECT status FROM items WHERE serial_number = 'FOC2707R4X6'").get() as { status: string }).status).toBe('roto');

    await expect(importWorkbook(file)).rejects.toThrow(/reemplazar/);
    // SFPs: unidades por caja, sueltos como cantidad, y stock mínimo por modelo.
    expect(paths).toContain('SFPs › Caja 2');
    const lx = db.prepare("SELECT kind, quantity FROM items WHERE description = 'GLC-LX-SM-RGD' ORDER BY kind").all();
    expect(lx).toEqual([{ kind: 'consumible', quantity: 8 }, { kind: 'unidad', quantity: 1 }]);
    const { modelStock, lowStockItems } = await import('../src/jobs/reminders.js');
    expect(modelStock()).toMatchObject([
      { model: 'GLC-LX-SM-RGD', min_qty: 10, available: 9 },
      { model: 'SFP-10G-SR-I', min_qty: 10, available: 0, notes: expect.stringContaining('no tenemos sin usar') },
    ]);
    expect(lowStockItems().filter((l) => l.kind === 'modelo')).toHaveLength(2);

    // Avisos: el préstamo importado no tiene responsable -> va al número/grupo interno.
    const { activeLoans, loansSummary, responsibleMessage, stockAlert } = await import('../src/jobs/reminders.js');
    const { saveSettings } = await import('../src/db/db.js');
    expect(activeLoans()[0].remind_to).toBeNull();
    saveSettings({ internal_alert_jid: '120363000000000000@g.us' });
    const [active] = activeLoans();
    expect(active.remind_to).toBe('120363000000000000@g.us');
    expect(responsibleMessage([active], '2026-07-07')).toContain('Hola equipo! Recordatorio: cisco touch10 ttc5-09 (S/N FOC2002NERH) está prestado a Edenor');
    const summary = loansSummary('2026-07-07')!;
    expect(summary).toContain('*Sin responsable* (1)');
    expect(summary).toContain('FOC2002NERH');
    expect(responsibleMessage([active, active], '2026-07-07')).toMatch(/^Hola equipo! Tenés 2 préstamos para reclamar:/);
    expect(stockAlert()).toContain('SFP-10G-SR-I: hay 0 u. (mínimo 10)');

    const again = await importWorkbook(file, { replace: true });
    expect(again.items).toBe(13);
    expect(count('SELECT COUNT(*) n FROM items')).toBe(13);
    expect(count('SELECT COUNT(*) n FROM contacts')).toBe(1);
  });
});
