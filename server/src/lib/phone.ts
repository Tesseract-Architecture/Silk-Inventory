/**
 * Normaliza un teléfono al formato internacional que usa WhatsApp (solo dígitos, sin +).
 * Pensado para Argentina: los celulares en WhatsApp van como 54 9 <área> <número>.
 *   "11 1234-5678"        -> 5491112345678
 *   "011 15 1234-5678"    -> 5491112345678
 *   "+54 9 11 1234 5678"  -> 5491112345678
 *   "+54 11 1234 5678"    -> 5491112345678
 *   "+34 612 345 678"     -> 34612345678 (otros países se dejan como están)
 * Devuelve null si no parece un número válido.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hasPlus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (!hasPlus && !d.startsWith('54')) {
    // Número nacional argentino.
    if (d.startsWith('0')) d = d.slice(1);
    d = stripAr15(d);
    if (d.length !== 10) return null;
    return '549' + d;
  }

  if (d.startsWith('54')) {
    let rest = d.slice(2);
    if (rest.startsWith('9')) rest = rest.slice(1);
    if (rest.startsWith('0')) rest = rest.slice(1);
    rest = stripAr15(rest);
    if (rest.length !== 10) return null;
    return '549' + rest;
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Saca el "15" de celulares escritos a la vieja usanza: área (2-4 dígitos) + 15 + número. */
function stripAr15(d: string): string {
  if (d.length !== 12) return d;
  for (const areaLen of [2, 3, 4]) {
    if (d.slice(areaLen, areaLen + 2) === '15') return d.slice(0, areaLen) + d.slice(areaLen + 2);
  }
  return d;
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '';
  if (digits.startsWith('549') && digits.length === 13) {
    const n = digits.slice(3);
    const area = n.startsWith('11') ? 2 : 3;
    return `+54 9 ${n.slice(0, area)} ${n.slice(area, n.length - 4)}-${n.slice(-4)}`;
  }
  return '+' + digits;
}
