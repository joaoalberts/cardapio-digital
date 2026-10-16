// Mesa lembrada no celular por 4 h (decisão A5 do João): quem leu o QR da mesa e reabre o
// cardápio sem o ?mesa= continua na mesma mesa. O servidor valida a mesa de novo a cada
// pedido e voto, então isto só evita ler o QR outra vez; não dá acesso a nada.

// Mesmo formato do Table de order-context.tsx.
export type Table = { code: string; label: string };

export const TABLE_MEMORY_MS = 4 * 60 * 60 * 1000;
// O relógio do celular pode andar para trás; uma hora gravada no futuro não estende a memória.
const SKEW_MS = 60_000;
// Mesmo formato do código do QR (mesa-tag.tsx).
const CODE = /^[A-Z2-9]{6}$/;
const LABEL_MAX = 80;

// Uma chave por restaurante: a mesa de um nunca vale no outro.
export const tableMemoryKey = (slug: string) => `cardapio-mesa:${slug}`;

export function writeTableMemory(t: Table, now: number): string {
  return JSON.stringify({ code: t.code, label: t.label, at: now });
}

// O que estiver malformado ou vencido vira "sem mesa": a memória só ajuda, não pode quebrar o cardápio.
export function readTableMemory(raw: string | null, now: number): Table | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as unknown;
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const { code, label, at } = d as Record<string, unknown>;
    if (typeof code !== "string" || !CODE.test(code)) return null;
    if (typeof label !== "string" || !label || label.length > LABEL_MAX) return null;
    if (typeof at !== "number" || !Number.isFinite(at) || at > now + SKEW_MS || now - at >= TABLE_MEMORY_MS) return null;
    return { code, label };
  } catch {
    return null;
  }
}
