// Nome ou @ opcional do cliente, mostrado embaixo do vídeo na TV. Até 30 caracteres e com
// filtro de palavrões em pt-BR. O texto é normalizado antes de comparar: sem acento, minúsculo,
// números e símbolos trocados por letras (p0rr4 → porra) e letras repetidas encurtadas.
// Formato do filtro (minha escolha, spec "a decidir"): duas listas.
// - RAIZES: pedaços longos e inequívocos, procurados dentro de cada palavra ("@putaria",
//   "arrombado"). Nada curto que apareça em nome ou sobrenome comum.
// - INTEIRAS: só batem como palavra inteira, porque aparecem dentro de palavras e nomes comuns
//   ("cu" em "cuscuz", "puta" em "computador", "otari" em "Botari", "babaca" em "Baba").
// O texto todo colado só é procurado quando todas as palavras têm até 2 letras ("p.o.r.r.a",
// "p o r r a"); colar nomes normais criaria palavrões na emenda ("Leonardo Tarifa").

export const NAME_MAX = 30;

const RAIZES = [
  "porra", "caralh", "buceta", "piroca", "merda", "arrombad", "cuzao", "xoxota", "xereca", "punheta", "boquete",
  "siririca", "putaria", "filhodaputa", "fodase", "fodido", "vagabund", "estupr", "pedofil", "hitler",
];
const INTEIRAS = new Set([
  "cu", "puta", "puto", "putas", "putos", "foda", "fode", "foder", "fdp", "vsf", "pqp", "krl", "crl", "tnc", "pau", "pica",
  "cacete", "caceta", "viado", "viadinho", "vadia", "corno", "piranha", "retardado", "retardada", "bct", "cuzinho", "xota",
  "otario", "otaria", "otarios", "babaca", "babacas", "nazi", "nazis", "nazista", "nazistas", "bosta", "bostas",
  "escroto", "escrota", "bucetas",
]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i" };

// Minúsculo, sem acento, leet trocado e 3+ letras iguais seguidas viram 2 ("porrrra" → "porra").
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c)
    .replace(/([a-z])\1{2,}/g, "$1$1");
}

function hasBadWord(name: string): boolean {
  const n = normalize(name);
  const words = n.split(/[^a-z]+/).filter(Boolean);
  const collapse = (w: string) => w.replace(/([a-z])\1+/g, "$1");
  // Letras soltas ("p.o.r.r.a"): junta e trata como uma palavra só.
  const parts = words.length > 1 && words.every((w) => w.length <= 2) ? [words.join("")] : words;
  for (const w of parts) if (INTEIRAS.has(w) || INTEIRAS.has(collapse(w))) return true;
  return RAIZES.some((r) => parts.some((w) => w.includes(r)));
}

export function cleanName(raw: unknown): { ok: true; name: string | null } | { ok: false; error: "long" | "bad_word" } {
  if (typeof raw !== "string") return { ok: true, name: null };
  // Tira caracteres de controle e junta espaços; emoji conta como um caractere.
  const name = raw.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, name: null };
  if ([...name].length > NAME_MAX) return { ok: false, error: "long" };
  if (hasBadWord(name)) return { ok: false, error: "bad_word" };
  return { ok: true, name };
}
