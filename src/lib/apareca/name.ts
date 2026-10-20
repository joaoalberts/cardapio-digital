// Nome ou @ opcional do cliente, mostrado embaixo do vídeo na TV. Até 30 caracteres e com
// filtro de palavrões em pt-BR. O texto é normalizado antes de comparar: sem acento, minúsculo,
// números e símbolos trocados por letras (p0rr4 → porra) e letras repetidas encurtadas.
// Formato do filtro (minha escolha, spec "a decidir"): duas listas e uma lista de exceções.
// - RAIZES: pedaços procurados dentro de cada palavra ("@putaria", "escrotinho", "bostinha").
// - INTEIRAS: só batem como palavra inteira, porque aparecem dentro de palavras comuns
//   ("cu" em "cuscuz", "puta" em "computador", "pica" em "picanha").
// - EXCECOES: palavras inteiras (nomes e palavras reais) que contêm uma raiz e não são palavrão
//   ("Botari" tem "otari", "Bostani" tem "bost", "notário" tem "otari").
// Palavrão quebrado em pedaços curtos ("p o r r a", "po rra", "fo da se"): cada sequência de
// palavras de até 2 letras é colada, e cada palavra curta também é colada com a vizinha. Palavras
// longas nunca são coladas entre si ("Homer Dantas" não vira "merda").

export const NAME_MAX = 30;
const SHORT = 2;

const RAIZES = [
  "porra", "caralh", "bucet", "piroca", "merda", "arrombad", "cuzao", "xoxota", "xereca", "punheta", "boquete",
  "siririca", "putaria", "filhodaputa", "fodase", "fodido", "vagabund", "estupr", "pedofil", "hitler",
  "nazis", "otari", "escrot", "bost", "babaquinh", "viadinh",
  // Racismo e automutilação.
  "crioul", "suicid",
  // Política: nada de nome de político, partido ou militância na TV (pedido do João, 19/10).
  "bolsonar", "bolsomin", "lulist", "petist", "lulalivre",
];
const INTEIRAS = new Set([
  "cu", "puta", "puto", "putas", "putos", "foda", "fode", "foder", "fdp", "vsf", "pqp", "krl", "crl", "tnc", "pau", "pica",
  "cacete", "caceta", "viado", "vadia", "corno", "piranha", "retardado", "retardada", "bct", "cuzinho", "xota",
  "babaca", "babacas", "nazi",
  "lula", "pt", "psol", "bozo",
]);
// Palavras inteiras que contêm uma raiz e passam (sobrenomes e palavras comuns).
const EXCECOES = new Set([
  "botari", "bostani", "escrotini", "notario", "notaria", "notarios", "notarias", "notarial", "boston", "bostrom",
  "bostick", "lotario", "lotaria",
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

const isBad = (w: string, collapse: (w: string) => string) =>
  INTEIRAS.has(w) || INTEIRAS.has(collapse(w)) || (!EXCECOES.has(w) && RAIZES.some((r) => w.includes(r)));

function hasBadWord(name: string): boolean {
  const n = normalize(name);
  const words = n.split(/[^a-z]+/).filter(Boolean);
  const collapse = (w: string) => w.replace(/([a-z])\1+/g, "$1");
  const parts = new Set(words);
  // Sequências de palavras curtas coladas ("p o r r a" → "porra", "fo da se" → "fodase").
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && words[j].length <= SHORT) j++;
    if (j - i >= 2) parts.add(words.slice(i, j).join(""));
    i = j > i ? j : i + 1;
  }
  // Cada palavra curta colada com a vizinha ("po rra" → "porra").
  words.forEach((w, i) => {
    if (w.length > SHORT) return;
    if (i > 0) parts.add(words[i - 1] + w);
    if (i + 1 < words.length) parts.add(w + words[i + 1]);
  });
  for (const w of parts) if (isBad(w, collapse)) return true;
  return false;
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
