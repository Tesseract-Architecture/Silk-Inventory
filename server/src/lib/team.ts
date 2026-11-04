import { config } from '../config.js';

/** "Julio Pérez" -> "julio.perez@silk-technologies.com" (los mails de la empresa son nombre.apellido). */
export function emailFromName(name: string, domain = config.teamEmailDomain): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const local = words.length === 1 ? words[0] : `${words[0]}.${words[words.length - 1]}`;
  return `${local}@${domain}`;
}
