// Uso:  npm run import -- inventario.xlsx [--dry] [--replace] [--all-sheets]
//       (en Docker: docker compose exec app node dist/import/cli.js /data/inventario.xlsx --dry)
import { importWorkbook } from './excel.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Uso: import <archivo.xlsx> [--dry] [--replace] [--all-sheets]');
  process.exit(1);
}

const report = await importWorkbook(file, {
  dryRun: args.includes('--dry'),
  replace: args.includes('--replace'),
  skipSheets: args.includes('--all-sheets') ? null : undefined,
});

console.log(report.dryRun ? '\n== PRUEBA (no se guardó nada) ==\n' : '\n== IMPORTACIÓN ==\n');
for (const s of report.sheets) {
  if (s.skippedReason) console.log(`- ${s.name}: OMITIDA — ${s.skippedReason}`);
  else console.log(`- ${s.name}: ${s.rows} filas (encabezado en fila ${s.headerRow}; columnas: ${Object.entries(s.columns).map(([k, v]) => `${v}→${k}`).join(', ')})`);
}
console.log(`\nÍtems: ${report.items}  Stock mínimo por modelo: ${report.stockRules}  Préstamos: ${report.loans}  Contactos nuevos: ${report.contacts}  Ubicaciones nuevas: ${report.locations}`);
if (report.warnings.length) {
  console.log(`\nAdvertencias (${report.warnings.length}):`);
  for (const w of report.warnings) console.log('  · ' + w);
}
