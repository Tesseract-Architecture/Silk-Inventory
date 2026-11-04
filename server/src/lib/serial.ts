// Números de serie: los lectores de código de barras leen la etiqueta Cisco "S/N: FCH2627Y066" y
// agregan una "S" adelante (SFCH2627Y066). Una serie Cisco tiene 11 caracteres: 3 letras, 4 dígitos
// y 4 alfanuméricos. Solo se saca la S cuando, sin ella, queda exactamente ese formato.
const CISCO_WITH_SCANNER_S = /^S([A-Z]{3}\d{4}[A-Z0-9]{4})$/;

export function cleanSerial(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return null;
  return s.replace(CISCO_WITH_SCANNER_S, '$1');
}
