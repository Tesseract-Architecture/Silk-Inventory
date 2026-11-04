import { config } from '../config.js';

/** Fecha local (zona horaria de la empresa) como YYYY-MM-DD. */
export function todayLocal(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
}

export function localParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { hour: Number(get('hour')), weekday: get('weekday') };
}
