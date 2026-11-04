// Envíos manuales por WhatsApp: a cada responsable, resumen de préstamos y alerta de stock.
import type { FastifyInstance } from 'fastify';
import { requireWrite } from '../auth/auth.js';
import { getSettings } from '../db/db.js';
import { normalizePhone } from '../lib/phone.js';
import {
  activeLoans, loansSummary, resolveTarget, responsibleMessage, sendLoansSummary, sendStockAlert, sendToResponsibles, stockAlert,
} from '../jobs/reminders.js';
import { listGroups } from '../whatsapp/client.js';

/** Persona de Equipo ("user:12"), grupo ("...@g.us") o número. Vacío = el destino configurado. */
function target(raw: unknown): string | undefined {
  const to = String(raw ?? '').trim();
  if (!to) return undefined;
  if (/^user:\d+$/.test(to)) {
    const phone = resolveTarget(to);
    if (!phone) throw new Error('Esa persona no tiene el WhatsApp cargado (Equipo)');
    return phone;
  }
  return to.includes('@') ? to : normalizePhone(to) ?? undefined;
}

export async function notifyRoutes(app: FastifyInstance) {
  /** Cómo quedaría cada mensaje, para revisarlo antes de mandar. */
  app.get('/api/notify/preview', async () => {
    const s = getSettings();
    const byResponsible = new Map<string, ReturnType<typeof activeLoans>>();
    const without: string[] = [];
    for (const l of activeLoans()) {
      if (!l.remind_to) {
        without.push(`${l.item_description} → ${l.contact_name}`);
        continue;
      }
      byResponsible.set(l.remind_to, [...(byResponsible.get(l.remind_to) ?? []), l]);
    }
    return {
      responsibles: [...byResponsible.entries()].map(([to, ls]) => ({
        to,
        name: ls[0].responsible_phone ? ls[0].responsible_name : 'Número/grupo interno',
        count: ls.length,
        text: responsibleMessage(ls),
      })),
      withoutTarget: without,
      // `configured`: lo elegido en Administración → Avisos (o el destino interno), tal cual se guardó.
      loansSummary: { configured: s.loans_summary_to || s.internal_alert_jid, text: loansSummary() },
      stock: { configured: s.stock_alert_to || s.internal_alert_jid, text: stockAlert() },
    };
  });

  /** Grupos de WhatsApp para elegir destino (vacío si no está conectado). */
  app.get('/api/notify/groups', { preHandler: requireWrite }, async () => {
    try {
      return await listGroups();
    } catch {
      return [];
    }
  });

  /** `to` (opcional): solo a ese responsable, con todos sus préstamos activos. */
  app.post('/api/notify/responsibles', { preHandler: requireWrite }, async (req, reply) => {
    const to = String((req.body as { to?: string } | undefined)?.to ?? '');
    const loans = activeLoans().filter((l) => !to || l.remind_to === to);
    const r = await sendToResponsibles(loans, req.user!.id);
    if (!r.sent && r.errors) return reply.code(502).send({ error: r.errorMessages.join(' · ') });
    return r;
  });

  app.post('/api/notify/loans-summary', { preHandler: requireWrite }, async (req, reply) => {
    try {
      await sendLoansSummary(req.user!.id, target((req.body as { to?: string } | undefined)?.to));
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post('/api/notify/stock', { preHandler: requireWrite }, async (req, reply) => {
    try {
      await sendStockAlert(req.user!.id, target((req.body as { to?: string } | undefined)?.to));
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
