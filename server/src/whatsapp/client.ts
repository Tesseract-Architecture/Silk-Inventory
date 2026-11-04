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

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });

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
    browser: Browsers.ubuntu('Inventario'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = s;

  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async (u) => {
    if (sock !== s) return;
    if (u.qr) {
      status = 'esperando_qr';
      qrDataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 300 });
    }
    if (u.connection === 'open') {
      status = 'conectado';
      qrDataUrl = null;
      reconnectAttempts = 0;
      me = s.user?.id?.split(':')[0].split('@')[0] ?? null;
      logger.info({ me }, 'WhatsApp conectado');
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
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
      } else {
        lastError = 'Se venció el código QR. Tocá "Vincular" de nuevo.';
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
