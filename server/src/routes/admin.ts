import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { entraAuthMethod, redirectUri, requireAdmin, resetEntra, testEntra } from '../auth/auth.js';
import { certInfo, generateCert, readCertPem } from '../auth/entraCert.js';
import { db, defaultSettings, getSettings, locationPaths, RESTORE_PENDING, saveSettings } from '../db/db.js';
import { todayLocal } from '../lib/dates.js';
import { normalizePhone } from '../lib/phone.js';
import { daysBetween, isOverdue } from '../lib/reminders.js';
import { activeLoans, lowStockItems, runDailyReminders } from '../jobs/reminders.js';
import { backupNow, listBackups } from '../jobs/backup.js';
import { importWorkbook } from '../import/excel.js';
import { connect, listGroups, logout, sendText, waState } from '../whatsapp/client.js';
import { config } from '../config.js';

export async function adminRoutes(app: FastifyInstance) {
  // ---------- dashboard (todos) ----------
  app.get('/api/dashboard', async () => {
    const today = todayLocal();
    const s = getSettings();
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const loans = activeLoans();
    const paths = locationPaths();

    const byLocationRaw = db
      .prepare(`SELECT location_id, COUNT(*) AS n FROM items WHERE status != 'baja' GROUP BY location_id`)
      .all() as { location_id: number | null; n: number }[];
    // Agrupar por ubicación raíz (Depósito 1, Armario 3, ...)
    const byRoot = new Map<string, number>();
    for (const r of byLocationRaw) {
      const root = r.location_id ? (paths.get(r.location_id) ?? '').split(' › ')[0] : 'Sin ubicación';
      byRoot.set(root, (byRoot.get(root) ?? 0) + r.n);
    }

    return {
      totals: {
        items: count("SELECT COUNT(*) AS n FROM items WHERE status != 'baja'"),
        loaned: loans.length,
        overdue: loans.filter((l) => isOverdue(l, today) || (!l.due_date && daysBetween(l.loaned_at, today) >= s.reminder_first_after_days)).length,
        lowStock: lowStockItems().length,
        broken: count("SELECT COUNT(*) AS n FROM items WHERE status IN ('roto','en_reparacion')"),
        boxMismatch: count("SELECT COUNT(*) AS n FROM items WHERE box_mismatch = 1 AND status != 'baja'"),
      },
      byLocation: [...byRoot.entries()]
        .map(([name, n]) => ({ name, n }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })),
      byCategory: db
        .prepare(
          `SELECT COALESCE(c.name, 'Sin categoría') AS name, COUNT(*) AS n FROM items i
           LEFT JOIN categories c ON c.id = i.category_id WHERE i.status != 'baja' GROUP BY c.name ORDER BY n DESC`,
        )
        .all(),
      loans: loans.slice(0, 50).map((l) => ({
        ...l,
        days: daysBetween(l.loaned_at, today),
        overdue: isOverdue(l, today) || (!l.due_date && daysBetween(l.loaned_at, today) >= s.reminder_first_after_days),
      })),
      lowStock: lowStockItems(),
      recent: db
        .prepare(
          `SELECT m.id, m.action, m.detail, m.created_at, m.item_id, i.code, i.description, u.name AS user
             FROM movements m LEFT JOIN items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id
            ORDER BY m.id DESC LIMIT 15`,
        )
        .all(),
      whatsapp: waState().status,
    };
  });

  // Estado de WhatsApp para el aviso del encabezado (todos los usuarios).
  app.get('/api/whatsapp/status', async () => {
    const s = waState();
    return { status: s.status, lastError: s.lastError };
  });

  // ---------- desde acá, solo admin ----------
  app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);

    // Login con Microsoft: lo que hay que cargar en Entra y una prueba de las credenciales del .env.
    admin.get('/api/admin/sso', async () => ({
      redirectUri: redirectUri(),
      tenantId: config.entra.tenantId,
      clientId: config.entra.clientId,
      hasSecret: !!config.entra.clientSecret,
      authMethod: entraAuthMethod(),
      certificate: certInfo(),
      allowedDomains: config.allowedDomains,
      devLogin: config.authDev,
    }));
    admin.post('/api/admin/sso/test', async () => testEntra());

    // Certificado en lugar del secreto (en Silk los secretos están bloqueados por directiva).
    admin.post('/api/admin/sso/certificate', async (req, reply) => {
      if (certInfo() && (req.query as { replace?: string }).replace !== '1') {
        return reply.code(409).send({ error: 'Ya hay un certificado. Generar otro invalida el actual hasta que subas el nuevo a Entra.' });
      }
      const info = await generateCert();
      resetEntra();
      req.log.warn({ by: req.user!.email, thumbprint: info.thumbprint }, 'Certificado de Entra generado');
      return info;
    });
    // Solo la parte pública: es lo que se sube a Entra.
    admin.get('/api/admin/sso/certificate.cer', async (_req, reply) => {
      if (!certInfo()) return reply.code(404).send({ error: 'Todavía no hay certificado' });
      return reply
        .header('Content-Type', 'application/x-x509-ca-cert')
        .header('Content-Disposition', 'attachment; filename="inventario-entra.cer"')
        .send(readCertPem());
    });

    admin.get('/api/admin/settings', async () => ({ settings: getSettings(), defaults: defaultSettings }));

    admin.put('/api/admin/settings', async (req, reply) => {
      const body = req.body as Partial<typeof defaultSettings>;
      // Destinos: persona de Equipo ("user:12"), grupo de WhatsApp (JID "...@g.us") o número (se normaliza).
      for (const key of ['internal_alert_jid', 'loans_summary_to', 'stock_alert_to'] as const) {
        const v = body[key];
        if (v && !v.includes('@') && !/^user:\d+$/.test(v)) {
          const n = normalizePhone(v);
          if (!n) return reply.code(400).send({ error: `El número "${v}" no es válido` });
          body[key] = n;
        }
      }
      saveSettings(body);
      return { settings: getSettings() };
    });

    // ---------- WhatsApp ----------
    admin.get('/api/admin/whatsapp', async () => waState());
    admin.post('/api/admin/whatsapp/connect', async (_req, reply) => {
      try {
        await connect();
        return waState();
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });
    admin.post('/api/admin/whatsapp/logout', async () => {
      await logout();
      return waState();
    });
    admin.get('/api/admin/whatsapp/groups', async (_req, reply) => {
      try {
        return await listGroups();
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });
    admin.post('/api/admin/whatsapp/test', async (req, reply) => {
      const { to, text } = req.body as { to: string; text?: string };
      const target = to?.includes('@') ? to : normalizePhone(to);
      if (!target) return reply.code(400).send({ error: 'Número inválido' });
      try {
        await sendText(target, text || '✅ Mensaje de prueba del sistema de inventario.');
        return { ok: true };
      } catch (e) {
        return reply.code(502).send({ error: (e as Error).message });
      }
    });

    admin.post('/api/admin/run-jobs', async () => runDailyReminders({ force: true }));

    // ---------- importación ----------
    admin.post('/api/admin/import', async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'Falta el archivo' });
      const query = req.query as { dry?: string; replace?: string };
      const dryRun = query.dry === '1';
      const replace = query.replace === '1';
      const tmp = path.join(os.tmpdir(), `import-${Date.now()}.xlsx`);
      await fs.promises.writeFile(tmp, await file.toBuffer());
      try {
        return await importWorkbook(tmp, { dryRun, replace, userId: req.user!.id });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    });

    // ---------- backups ----------
    admin.get('/api/admin/backups', async () => listBackups());
    admin.post('/api/admin/backups', async () => ({ file: await backupNow() }));
    // Volver toda la base a un backup: se hace un backup de seguridad, se deja el archivo
    // preparado y se reinicia el proceso (Docker lo levanta de nuevo con la base restaurada).
    admin.post('/api/admin/backups/:name/restore', async (req, reply) => {
      const name = path.basename((req.params as { name: string }).name);
      const file = path.join(config.backupDir, name);
      if (!fs.existsSync(file)) return reply.code(404).send({ error: 'No existe' });
      const safety = await backupNow('antes-de-restaurar');
      fs.copyFileSync(file, RESTORE_PENDING);
      req.log.warn({ name, safety, by: req.user!.email }, 'Restaurando backup; reiniciando');
      setTimeout(() => process.exit(0), 500);
      return { ok: true, safety };
    });

    admin.get('/api/admin/backups/:name', async (req, reply) => {
      const name = path.basename((req.params as { name: string }).name);
      const file = path.join(config.backupDir, name);
      if (!fs.existsSync(file)) return reply.code(404).send({ error: 'No existe' });
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .send(fs.createReadStream(file));
    });
  });
}
