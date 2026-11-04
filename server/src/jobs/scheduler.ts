import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { getSettings } from '../db/db.js';
import { localParts } from '../lib/dates.js';
import { runDailyReminders } from './reminders.js';
import { backupNow } from './backup.js';

export function startScheduler(log: FastifyBaseLogger) {
  // Cada hora en punto: si es la hora configurada, manda recordatorios.
  cron.schedule(
    '0 * * * *',
    async () => {
      const s = getSettings();
      const { hour, weekday } = localParts();
      if (hour !== s.reminder_hour) return;
      if (s.reminder_weekdays_only && (weekday === 'Sat' || weekday === 'Sun')) return;
      try {
        const r = await runDailyReminders();
        log.info(r, 'Recordatorios diarios');
      } catch (e) {
        log.error(e, 'Falló el job de recordatorios');
      }
    },
    { timezone: config.timezone },
  );

  // Backup diario a las 3 AM.
  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        log.info({ file: await backupNow() }, 'Backup diario');
      } catch (e) {
        log.error(e, 'Falló el backup');
      }
    },
    { timezone: config.timezone },
  );
}
