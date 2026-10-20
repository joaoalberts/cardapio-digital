// Massa da pizza: o dono cadastra de 2 a 4 massas por categoria com meio a meio, cada uma com um
// valor extra opcional. Puro e só com tipos de lib/menu (data.ts importa este arquivo).
import type { Dough, MenuItem } from "@/lib/menu/types";

export const DOUGH_LABEL_MAX = 20;
export const DOUGH_EXTRA_MAX = 5000;

// Qualquer massa inválida derruba a lista toda: melhor sem escolha de massa do que uma escolha torta.
export function parseDoughs(raw: unknown): Dough[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return null;
  const out: Dough[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (!d || typeof d !== "object") return null;
    const { label, extra_cents } = d as Record<string, unknown>;
    if (typeof label !== "string") return null;
    const name = label.trim();
    if (!name || name.length > DOUGH_LABEL_MAX || seen.has(name.toLowerCase())) return null;
    const extra = extra_cents ?? 0;
    if (typeof extra !== "number" || !Number.isInteger(extra) || extra < 0 || extra > DOUGH_EXTRA_MAX) return null;
    seen.add(name.toLowerCase());
    out.push({ label: name, extra_cents: extra });
  }
  return out;
}

// Validação do que o dono manda no painel: linhas sem nome são ignoradas; o resto passa por parseDoughs.
export function validateDoughs(raw: unknown): { doughs: Dough[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : [];
  const rows = list.filter((d) => d && typeof d === "object" && String((d as { label?: unknown }).label ?? "").trim());
  const badExtra = rows.some((d) => {
    const e = (d as { extra_cents?: unknown }).extra_cents ?? 0;
    return typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > DOUGH_EXTRA_MAX;
  });
  if (badExtra) return { error: "O valor extra da massa vai de R$ 0 a R$ 50." };
  const doughs = parseDoughs(rows);
  return doughs ? { doughs } : { error: "Informe de 2 a 4 tipos de massa, com nomes diferentes." };
}

export type DoughResult = { ok: true; dough: string | null; extra: number } | { ok: false };

// Prato sem massas só aceita linha sem massa. Com massas, linha sem massa (carrinho antigo)
// usa a primeira; massa que não existe mais é recusada.
export function resolveDough(item: MenuItem, dough: string | null | undefined): DoughResult {
  const list = item.doughs;
  if (!list?.length) return dough == null ? { ok: true, dough: null, extra: 0 } : { ok: false };
  const d = dough == null ? list[0] : list.find((x) => x.label === dough);
  return d ? { ok: true, dough: d.label, extra: d.extra_cents } : { ok: false };
}
