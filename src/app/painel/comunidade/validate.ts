// Formulário de enquete e regras do painel da Comunidade: confere e monta a linha do banco.
// Puro (sem rede), para testar; as actions usam antes de gravar e o editor usa para sugerir.
import { communityDay, dayBounds, pollPhase } from "@/lib/comunidade/clock";
import { ct } from "@/lib/comunidade/i18n";
import type { OptionId, PollOption, PollRow, PollTemplate } from "@/lib/comunidade/types";

export const POLL_MINUTES = [5, 10, 15, 30] as const;
export type PollMinutes = (typeof POLL_MINUTES)[number];
export type PollInput = {
  template: PollTemplate;
  question: string;
  options: { label: string; item_id: string | null }[];
  start: string | null; // "HH:MM" de hoje no fuso do restaurante; null = agora
  minutes: PollMinutes;
};
export type PollDraft = Omit<PollRow, "id" | "restaurant_id" | "created_at" | "closed_at">;

export const TEMPLATES: readonly PollTemplate[] = ["dessert", "drink", "music", "custom"];
const TEMPLATE_KEY = { dessert: "tplDessert", drink: "tplDrink", music: "tplMusic" } as const;
const IDS: readonly OptionId[] = ["a", "b", "c"];
export const LABEL_MAX = 40;
export const QUESTION_MIN = 3;
export const QUESTION_MAX = 90;
// Tolerância para "agora": quem escolhe a hora atual no relógio do celular não erra por segundos.
const PAST_TOLERANCE_MS = 60_000;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Pergunta do modelo em pt-BR (o cliente lê a tradução do modelo; na personalizada, o texto da casa).
export const templateQuestion = (t: Exclude<PollTemplate, "custom">) => ct(TEMPLATE_KEY[t], "pt-BR");

// Uma linha, sem caracteres de controle e sem espaço sobrando.
const oneLine = (s: unknown) =>
  typeof s === "string" ? s.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim() : "";
const chars = (s: string) => Array.from(s).length;
const cut = (s: string, max: number) => Array.from(s).slice(0, max).join("").trim();

const fail = (error: string) => ({ ok: false as const, error });

export function validatePoll(
  input: PollInput,
  menuItemIds: Set<string>,
  now: Date,
  timezone: string,
): { ok: true; row: PollDraft } | { ok: false; error: string } {
  const template = input?.template;
  if (!TEMPLATES.includes(template)) return fail("Escolha um modelo de enquete.");

  let question: string;
  if (template === "custom") {
    question = oneLine(input.question);
    if (chars(question) < QUESTION_MIN || chars(question) > QUESTION_MAX) return fail("Escreva a pergunta com 3 a 90 caracteres.");
  } else {
    question = templateQuestion(template);
  }

  const raw = input.options;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) return fail("Escolha 2 ou 3 opções.");
  const options: PollOption[] = [];
  for (const [k, o] of raw.entries()) {
    const item = o && typeof o === "object" ? o.item_id : null;
    const label = oneLine(o && typeof o === "object" ? o.label : "");
    if (item !== null && item !== undefined && item !== "") {
      if (typeof item !== "string" || !UUID.test(item) || !menuItemIds.has(item)) return fail("Escolha um prato que está no cardápio.");
      // O nome do prato fica como reserva, para o caso de ele sair do cardápio.
      options.push({ id: IDS[k], label: cut(label, LABEL_MAX), item_id: item });
    } else {
      if (!label || chars(label) > LABEL_MAX) return fail("Cada opção precisa de um prato ou de um texto de até 40 caracteres.");
      options.push({ id: IDS[k], label, item_id: null });
    }
  }
  const keys = options.map((o) => o.item_id ?? `t:${o.label.toLocaleLowerCase("pt-BR")}`);
  if (new Set(keys).size !== keys.length) return fail("Escolha opções diferentes.");

  const minutes = input.minutes;
  if (typeof minutes !== "number" || !POLL_MINUTES.includes(minutes as PollMinutes)) return fail("A enquete dura 5, 10, 15 ou 30 minutos.");

  const nowMs = Math.floor(now.getTime() / 1000) * 1000;
  let startMs = nowMs;
  if (input.start !== null && input.start !== undefined) {
    if (typeof input.start !== "string" || !HHMM.test(input.start)) return fail("Confira a hora de início.");
    // Hoje = a data do calendário no fuso do restaurante (o dia vira à meia-noite aqui).
    const today = communityDay(now, timezone, "00:00");
    startMs = dayBounds(today, timezone, input.start).from.getTime();
    if (startMs < now.getTime() - PAST_TOLERANCE_MS) return fail("Esse horário já passou. Escolha agora ou uma hora mais tarde hoje.");
  }

  return {
    ok: true,
    row: {
      template,
      question,
      options,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(startMs + minutes * 60_000).toISOString(),
    },
  };
}

// Duas enquetes no ar ao mesmo tempo confundem o telão e o celular (só uma aparece): a nova
// não pode cruzar com uma aberta ou agendada. Encostar no fim da outra pode.
export function pollOverlap(row: { starts_at: string; ends_at: string }, polls: PollRow[], now: Date): boolean {
  const s = Date.parse(row.starts_at);
  const e = Date.parse(row.ends_at);
  return polls.some((p) => {
    if (pollPhase(p, now) === "closed") return false;
    return s < Date.parse(p.ends_at) && Date.parse(p.starts_at) < e;
  });
}

// Foto da casa: só arquivo da pasta comunidade do próprio restaurante (Blob ou driver local)
// e só foto (.webp, .jpg, .jpeg ou .png): um vídeo da mesma pasta não vira post do Mural.
// A posse do arquivo (ownsFile) é conferida à parte, no servidor.
const PHOTO_EXT = /\.(webp|jpe?g|png)$/i;
export function inCommunityFolder(restaurantId: string, url: string): boolean {
  if (typeof url !== "string" || !url || url.length > 500) return false;
  let path: string;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    return false;
  }
  const parts = path.split("/");
  const at = parts.indexOf(restaurantId);
  if (at < 0 || parts[at + 1] !== "comunidade") return false;
  const rest = parts.slice(at + 2);
  return (
    rest.length === 1 &&
    /^[\w.-]{1,90}$/.test(rest[0]) &&
    !rest[0].startsWith(".") &&
    PHOTO_EXT.test(rest[0]) &&
    !url.includes("..")
  );
}

// Opções já preenchidas ao abrir um modelo, para criar em menos de 1 minuto: sobremesa e
// drink pegam até 3 pratos da primeira categoria cujo nome combina; o resto começa vazio.
const MATCH: Partial<Record<PollTemplate, RegExp>> = {
  dessert: /sobremesa|doce|dessert|torta|bolo/i,
  drink: /bebida|drink|chopp|chope|cerveja|coquetel|vinho|suco|refri/i,
};
export function suggestOptions(
  template: PollTemplate,
  categories: { name: string; items: { id: string; name: string }[] }[],
): { label: string; item_id: string | null }[] {
  const empty = { label: "", item_id: null };
  const re = MATCH[template];
  const cat = re ? categories.find((c) => re.test(c.name) && c.items.length) : undefined;
  if (!cat) return [empty, { ...empty }];
  const picked: { label: string; item_id: string | null }[] = cat.items
    .slice(0, 3)
    .map((i) => ({ label: cut(i.name, LABEL_MAX), item_id: i.id }));
  while (picked.length < 2) picked.push({ ...empty });
  return picked;
}
