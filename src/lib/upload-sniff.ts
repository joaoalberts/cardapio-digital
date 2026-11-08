// Confere os primeiros bytes do arquivo enviado: o Content-Type vem do navegador e não prova
// nada. Sem a assinatura certa do tipo declarado (ou com "<", como um SVG ou HTML), recusa.
const starts = (b: Uint8Array, at: number, sig: readonly number[]) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function matchesSignature(bytes: Uint8Array, type: string): boolean {
  if (bytes[0] === 0x3c) return false; // "<": SVG, HTML ou XML
  switch (type) {
    case "image/png":
      return starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return starts(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/webp": // RIFF....WEBP
      return starts(bytes, 0, ascii("RIFF")) && starts(bytes, 8, ascii("WEBP"));
    case "video/mp4":
    case "video/quicktime": // "ftyp" nos bytes 4 a 8
      return starts(bytes, 4, ascii("ftyp"));
    case "video/webm":
      return starts(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}
