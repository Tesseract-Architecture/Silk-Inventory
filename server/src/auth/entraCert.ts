// Certificado para autenticar la app ante Entra (private_key_jwt) en lugar de un secreto de cliente.
// En Silk los secretos están bloqueados por directiva del inquilino; con certificado la clave privada
// nunca sale del server y a Entra se sube solo la parte pública (.cer).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generate } from 'selfsigned';
import { config } from '../config.js';

const keyPath = () => path.join(config.entraCertDir, 'key.pem');
const certPath = () => path.join(config.entraCertDir, 'cert.pem');

export interface CertInfo {
  /** Huella SHA-1 en hexa, como la muestra Entra en "Certificados". */
  thumbprint: string;
  /** La misma huella en base64url: va en el encabezado x5t del JWT. */
  x5t: string;
  validFrom: string;
  validTo: string;
  subject: string;
}

export function certExists(): boolean {
  return fs.existsSync(keyPath()) && fs.existsSync(certPath());
}

export function readCertPem(): string {
  return fs.readFileSync(certPath(), 'utf8');
}

export function certInfo(): CertInfo | null {
  if (!certExists()) return null;
  const x509 = new crypto.X509Certificate(readCertPem());
  const sha1 = crypto.createHash('sha1').update(x509.raw);
  return {
    thumbprint: sha1.copy().digest('hex').toUpperCase(),
    x5t: sha1.digest('base64url'),
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
    subject: x509.subject,
  };
}

/** Genera clave RSA 2048 + certificado autofirmado por 2 años (lo máximo que conviene en Entra). */
export async function generateCert(): Promise<CertInfo> {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 2);
  const pems = await generate([{ name: 'commonName', value: 'Inventario Silk (Entra ID)' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
  });
  fs.mkdirSync(config.entraCertDir, { recursive: true });
  fs.writeFileSync(keyPath(), pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath(), pems.cert);
  return certInfo()!;
}

/** Clave privada lista para firmar el client_assertion (RS256). */
export async function signingKey(): Promise<CryptoKey> {
  const der = crypto.createPrivateKey(fs.readFileSync(keyPath(), 'utf8')).export({ type: 'pkcs8', format: 'der' });
  return globalThis.crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
