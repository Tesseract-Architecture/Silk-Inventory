import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from 'baileys';
import { config } from '../config.js';

export type WaStatus = 'deshabilitado' | 'desconectado' | 'conectando' | 'esperando_qr' | 'conectado';

// Baileys es muy ruidoso: solo advertencias. Los pasos de la vinculación van por `log`.
const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });
const log = pino({ level: 'info', base: { modulo: 'whatsapp' } });

const REASONS: Record<number, string> = {
  [DisconnectReason.loggedOut]: 'sesión cerrada desde el teléfono',
  [DisconnectReason.restartRequired]: 'WhatsApp pide reiniciar la conexión (normal después de escanear)',
  [DisconnectReason.timedOut]: 'se venció el QR sin escanear o se perdió la conexión', // 408 (= connectionLost)
  [DisconnectReason.connectionClosed]: 'conexión cerrada',
  [DisconnectReason.connectionReplaced]: 'otra sesión reemplazó a esta',
  [DisconnectReason.badSession]: 'sesión dañada',
  [DisconnectReason.multideviceMismatch]: 'el teléfono no acepta dispositivos vinculados',
  [DisconnectReason.forbidden]: 'WhatsApp rechazó la conexión',
  [DisconnectReason.unavailableService]: 'servicio de WhatsApp no disponible',
};

let sock: WASocket | null = null;
let status: WaStatus = config.whatsappEnabled ? 'desconectado' : 'deshabilitado';
let qrDataUrl: string | null = null;
let lastError: string | null = null;
let me: string | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

export function waState() {
  return { status, qr: status === 'esperando_qr' ? qrDataUrl : null, me, lastError };
}

function hasSession(): boolean {
  return fs.existsSync(path.join(config.waSessionDir, 'creds.json'));
}

/** Al arrancar el server: si ya hay un número vinculado, se reconecta solo. */
export async function initWhatsApp() {
  if (!config.whatsappEnabled) return;
  if (hasSession()) await connect();
}

export async function connect(): Promise<void> {
  if (!config.whatsappEnabled) throw new Error('WhatsApp está deshabilitado (WHATSAPP_ENABLED=0)');
  if (status === 'conectado' || status === 'conectando' || status === 'esperando_qr') return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  status = 'conectando';
  lastError = null;

  fs.mkdirSync(config.waSessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.waSessionDir);
  const linked = !!state.creds.registered || !!state.creds.me;

  let version: [number, number, number] | undefined;
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {
    /* sin internet: usa la versión que trae la librería */
  }

  const s = makeWASocket({
    auth: state,
    version,
    logger,
    // Tiene que ser un navegador real: con nombres inventados WhatsApp rechaza el vínculo
    // ("No se pudo vincular el dispositivo"). En el celular aparece como "Chrome (Ubuntu)".
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = s;

  log.info({ version, linked }, 'Conectando con WhatsApp');
  s.ev.on('creds.update', async () => {
    await saveCreds();
    if (s.authState.creds.me && !me) log.info({ me: s.authState.creds.me.id }, 'Vinculación aceptada por el teléfono');
  });
  s.ev.on('connection.update', async (u) => {
    if (sock !== s) return;
    if (u.qr) {
      status = 'esperando_qr';
      // SVG (nítido a cualquier tamaño), corrección "L" como WhatsApp Web (menos módulos) y el margen
      // blanco estándar de 4 módulos. Un PNG achicado en pantalla queda borroso y el celular no lo lee.
      const svg = await QRCode.toString(u.qr, { type: 'svg', errorCorrectionLevel: 'L', margin: 4 });
      qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      log.info('QR nuevo listo para escanear');
    }
    if (u.connection === 'open') {
      status = 'conectado';
      qrDataUrl = null;
      lastError = null;
      reconnectAttempts = 0;
      me = s.user?.id?.split(':')[0].split('@')[0] ?? null;
      log.info({ me }, 'WhatsApp conectado');
    }
    if (u.connection === 'close') {
      const err = u.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
      const code = err?.output?.statusCode;
      log.warn({ code, reason: code ? REASONS[code] : undefined, error: err?.message }, 'Conexión con WhatsApp cerrada');
      sock = null;
      qrDataUrl = null;
      status = 'desconectado';
      if (code === DisconnectReason.loggedOut) {
        // Desvincularon el dispositivo desde el celular: borrar la sesión.
        lastError = 'La sesión se cerró desde el teléfono. Hay que volver a vincular.';
        me = null;
        fs.rmSync(config.waSessionDir, { recursive: true, force: true });
        return;
      }
      const nowLinked = linked || !!s.authState.creds.me;
      if (nowLinked || code === DisconnectReason.restartRequired) {
        // Vinculado (o recién vinculado: WhatsApp pide reiniciar): reconectar con espera creciente.
        const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** reconnectAttempts++);
        reconnectTimer = setTimeout(() => connect().catch((e) => (lastError = String(e))), delay);
      } else if (code === DisconnectReason.timedOut || code === undefined) {
        lastError = 'Se venció el código QR. Tocá "Vincular" de nuevo.';
      } else {
        lastError = `WhatsApp cortó la vinculación: ${REASONS[code] ?? 'motivo desconocido'} (código ${code}). Probá de nuevo; si se repite, mirá los logs del server.`;
      }
    }
  });
}

export async function logout() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const s = sock;
  sock = null;
  try {
    await s?.logout();
  } catch {
    /* ignorar */
  }
  fs.rmSync(config.waSessionDir, { recursive: true, force: true });
  status = config.whatsappEnabled ? 'desconectado' : 'deshabilitado';
  me = null;
  qrDataUrl = null;
}

function requireSocket(): WASocket {
  if (!sock || status !== 'conectado') throw new Error('WhatsApp no está conectado');
  return sock;
}

/** Envía un texto. `to` puede ser un número (solo dígitos) o un JID (ej. grupo "...@g.us"). */
export async function sendText(to: string, text: string): Promise<void> {
  const s = requireSocket();
  let jid = to;
  if (!to.includes('@')) {
    const [res] = (await s.onWhatsApp(to)) ?? [];
    if (!res?.exists) throw new Error(`El número +${to} no tiene WhatsApp`);
    jid = res.jid;
  }
  await s.sendMessage(jid, { text });
}

export async function listGroups(): Promise<{ id: string; name: string }[]> {
  const s = requireSocket();
  const groups = await s.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({ id: g.id, name: g.subject }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
