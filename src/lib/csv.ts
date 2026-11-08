// Célula de CSV entre aspas. Texto que começa com = + - @ (ou tab/CR) o Excel e o Google
// Planilhas executam como fórmula: um apóstrofo na frente deixa só texto.
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
