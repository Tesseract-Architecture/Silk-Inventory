import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone } from '../src/lib/phone.js';
import { daysBetween, renderReminder, shouldRemind } from '../src/lib/reminders.js';
import { matchHeader, parseNotes, titleCase } from '../src/import/parse.js';

describe('normalizePhone', () => {
  it.each([
    ['11 1234-5678', '5491112345678'],
    ['011 15 1234-5678', '5491112345678'],
    ['+54 9 11 1234 5678', '5491112345678'],
    ['+54 11 1234 5678', '5491112345678'],
    ['5491112345678', '5491112345678'],
    ['0351 15 612-3456', '5493516123456'],
    ['+34 612 345 678', '34612345678'],
  ])('%s -> %s', (raw, exp) => expect(normalizePhone(raw)).toBe(exp));
  it('rechaza basura', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('formatea', () => expect(formatPhone('5491112345678')).toBe('+54 9 11 1234-5678'));
});

describe('shouldRemind', () => {
  const s = { reminder_first_after_days: 7, reminder_every_days: 7 };
  const base = {
    loaned_at: '2026-11-01', due_date: null, returned_at: null, reminders_paused: 0,
    reminder_every_days: null, last_reminder_at: null, remind_to: '5491112345678',
  };
  it('no antes de 7 días', () => expect(shouldRemind(base, s, '2026-11-07')).toBe(false));
  it('sí a los 7 días', () => expect(shouldRemind(base, s, '2026-11-08')).toBe(true));
  it('repite cada 7', () => {
    const l = { ...base, last_reminder_at: '2026-11-08' };
    expect(shouldRemind(l, s, '2026-11-14')).toBe(false);
    expect(shouldRemind(l, s, '2026-11-15')).toBe(true);
  });
  it('semanal: el día elegido va todo lo que ya pasó el primer aviso, una vez por día', () => {
    expect(shouldRemind(base, s, '2026-11-07', true)).toBe(false);
    const l = { ...base, last_reminder_at: '2026-11-12' }; // aviso manual un jueves
    expect(shouldRemind(l, s, '2026-11-16', true)).toBe(true); // el lunes siguiente igual sale
    expect(shouldRemind({ ...l, last_reminder_at: '2026-11-16 13:00:00' }, s, '2026-11-16', true)).toBe(false);
  });
  it('con fecha de devolución espera al vencimiento', () => {
    const l = { ...base, due_date: '2026-11-30' };
    expect(shouldRemind(l, s, '2026-11-20')).toBe(false);
    expect(shouldRemind(l, s, '2026-11-30')).toBe(false);
    expect(shouldRemind(l, s, '2026-12-01')).toBe(true);
  });
  it('pausado, devuelto o sin a quién mandar: nunca', () => {
    expect(shouldRemind({ ...base, reminders_paused: 1 }, s, '2026-12-30')).toBe(false);
    expect(shouldRemind({ ...base, returned_at: '2026-11-05' }, s, '2026-12-30')).toBe(false);
    expect(shouldRemind({ ...base, remind_to: null }, s, '2026-12-30')).toBe(false);
  });
  it('daysBetween cruza meses', () => expect(daysBetween('2026-06-30', '2026-11-03')).toBe(126));
});

describe('renderReminder', () => {
  it('arma el mensaje para el responsable', () => {
    const msg = renderReminder(
      'Hola {nombre}! Recordatorio: {item}{serie} está prestado a {quien} desde el {fecha} ({dias} días).{vence} ¿Lo reclamamos?',
      {
        nombre: 'Maxi Bianchi', quien: 'Edenor', item: 'cisco touch10', serie: 'FOC2002NERH',
        loaned_at: '2026-06-30', due_date: '2026-07-05', today: '2026-07-07',
      },
    );
    expect(msg).toBe(
      'Hola Maxi! Recordatorio: cisco touch10 (S/N FOC2002NERH) está prestado a Edenor desde el 30/06/2026 (7 días).' +
        ' La devolución estaba prevista para el 05/07/2026. ¿Lo reclamamos?',
    );
  });
  it('sin fecha conocida no inventa la fecha', () => {
    const msg = renderReminder('{item} está prestado a {quien} desde el {fecha} ({dias} días).', {
      nombre: 'Maxi', quien: 'OCP', item: 'cisco nexus', serie: null,
      loaned_at: '2026-11-04', date_unknown: true, due_date: null, today: '2026-11-11',
    });
    expect(msg).toBe('cisco nexus está prestado a OCP desde una fecha que no tenemos (más de 7 días).');
  });
});

describe('import parse', () => {
  it('detecta encabezados del Excel', () => {
    expect(matchHeader('ID')).toBe('id');
    expect(matchHeader('Ubicación')).toBe('location');
    expect(matchHeader('Estante')).toBe('shelf');
    expect(matchHeader('Categoría')).toBe('category');
    expect(matchHeader('Descripción / Modelo')).toBe('description');
    expect(matchHeader('N° de serie')).toBe('serial');
    expect(matchHeader('Notas')).toBe('notes');
  });
  it('lee préstamos de las notas', () => {
    expect(parseNotes('PRESTADO A EDENOR 30/6/2026').loan).toEqual({ who: 'EDENOR', date: '2026-06-30' });
    expect(parseNotes('prestado a Juan Gomez').loan).toEqual({ who: 'Juan Gomez', date: null });
    expect(titleCase('EDENOR')).toBe('Edenor');
  });
  it('detecta caja que no corresponde y roto', () => {
    expect(parseNotes('la caja no corresponde').boxMismatch).toBe(true);
    expect(parseNotes('la caja no es de ese numero de serie').boxMismatch).toBe(true);
    expect(parseNotes('esta roto').broken).toBe(true);
    expect(parseNotes('ya casi no hay mas')).toEqual({ loan: null, holder: null, boxMismatch: false, broken: false, status: null });
    expect(parseNotes('fuente con falla').broken).toBe(true);
  });
  it('casos reales del Excel', () => {
    expect(parseNotes('PRESTADO A EDENOR').loan).toEqual({ who: 'EDENOR', date: null });
    expect(parseNotes('PRESTADO A PLUSPETROL 28/8/2026').loan).toEqual({ who: 'PLUSPETROL', date: '2026-08-28' });
    expect(parseNotes('SE LO LLEVO MATI A ? 27/10/2026')).toMatchObject({ loan: null, holder: 'MATI', status: 'en_uso' });
    expect(parseNotes('LO TIENE FER EN LA OFICINA')).toMatchObject({ loan: null, holder: 'FER', status: 'en_uso' });
    expect(parseNotes('SEPARADOS PARA ALIVE 28/9/2026')).toMatchObject({ loan: null, status: 'reservado' });
    expect(parseNotes('MAQUETA ROS').status).toBe('en_uso');
    expect(parseNotes('Esta en C9500-16X-A').status).toBe('en_uso');
    expect(parseNotes('EN EL RACK').status).toBe('en_uso');
    expect(parseNotes('llevar a estomba????')).toEqual({ loan: null, holder: null, boxMismatch: false, broken: false, status: null });
  });
});

describe('emailFromName', () => {
  it('arma nombre.apellido@dominio sin acentos', async () => {
    const { emailFromName } = await import('../src/lib/team.js');
    expect(emailFromName('Julio Pérez', 'silk-technologies.com')).toBe('julio.perez@silk-technologies.com');
    expect(emailFromName('  María José Núñez ', 'silk-technologies.com')).toBe('maria.nunez@silk-technologies.com');
    expect(emailFromName('Fer', 'silk-technologies.com')).toBe('fer@silk-technologies.com');
  });
});

describe('carga de equipo', () => {
  it('saca mails de un texto pegado y arma el nombre', async () => {
    const { extractEmails, nameFromEmail } = await import('../src/lib/team.js');
    const pegado = 'mateo.szumowski@silk-technologies.com matias.anon@silk-technologies.com,\nJULIO.ROSAL@silk-technologies.com; julio.rosal@silk-technologies.com';
    expect(extractEmails(pegado)).toEqual([
      'mateo.szumowski@silk-technologies.com',
      'matias.anon@silk-technologies.com',
      'julio.rosal@silk-technologies.com',
    ]);
    expect(nameFromEmail('anahi.centurion@silk-technologies.com')).toBe('Anahi Centurion');
  });
});

describe('cleanSerial', () => {
  it('saca la S que agrega el lector solo en series Cisco', async () => {
    const { cleanSerial } = await import('../src/lib/serial.js');
    expect(cleanSerial('SFCH2627Y066')).toBe('FCH2627Y066');
    expect(cleanSerial(' ssdg2510eu65 ')).toBe('SDG2510EU65');
    expect(cleanSerial('FCH2627Y07L')).toBe('FCH2627Y07L'); // ya estaba bien
    expect(cleanSerial('SPC171406H7')).toBe('SPC171406H7'); // 11 caracteres: es la serie real
    expect(cleanSerial('Q2GW-CRDT-E34H')).toBe('Q2GW-CRDT-E34H'); // Meraki
    expect(cleanSerial('')).toBeNull();
  });
});
