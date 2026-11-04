import { config } from '../config.js';

/** "julio.rosal@silk-technologies.com" -> "Julio Rosal" (al entrar con Microsoft se reemplaza por el nombre real). */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Saca todos los mails de un texto pegado (separados por espacios, comas, renglones, ;…). */
export function extractEmails(text: string): string[] {
  const found = text.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  return [...new Set(found)];
}

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
