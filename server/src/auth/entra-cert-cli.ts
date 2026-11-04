// Genera el certificado para Entra sin tener que entrar a la app (en el server todavía no hay login).
// Uso:  npm run entra-cert            (en Docker: docker compose exec app node dist/auth/entra-cert-cli.js)
//       agregar --replace para reemplazar uno existente.
import path from 'node:path';
import { config } from '../config.js';
import { certInfo, generateCert } from './entraCert.js';

const existing = certInfo();
if (existing && !process.argv.includes('--replace')) {
  console.log(`Ya hay un certificado (huella ${existing.thumbprint}, vence ${existing.validTo.slice(0, 10)}).`);
  console.log('Para reemplazarlo: agregá --replace (después hay que subir el nuevo a Entra).');
} else {
  const info = await generateCert();
  console.log('Certificado generado.');
  console.log(`  Huella (Entra la muestra así): ${info.thumbprint}`);
  console.log(`  Vence: ${info.validTo.slice(0, 10)}`);
}
console.log(`\nSubí a Entra (Certificados y secretos → Certificados → Cargar certificado) este archivo:`);
console.log(`  ${path.join(config.entraCertDir, 'cert.pem')}`);
console.log('La clave privada (key.pem) queda en esa carpeta y no se comparte.');
