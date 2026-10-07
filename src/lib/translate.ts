import "server-only";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  de: "German",
};

export type Texts = { name: string; description: string };

export function translationEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.TRANSLATE_FAKE === "1");
}

// Sugere a tradução de um prato ou categoria escrito em português. O dono revisa no painel.
// Sem chave configurada devolve null e o painel deixa o campo para preencher à mão.
export async function suggestTranslation(texts: Texts, to: string): Promise<Texts | null> {
  if (process.env.TRANSLATE_FAKE === "1") {
    return { name: `[${to}] ${texts.name}`, description: texts.description && `[${to}] ${texts.description}` };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  const target = LANG_NAMES[to];
  if (!key || !target) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.TRANSLATE_MODEL ?? "claude-haiku-4-5",
      max_tokens: 800,
      system:
        "You translate restaurant menu entries from Brazilian Portuguese. Keep dish names that are " +
        "proper names or well known in their original form (e.g. Margherita, Tiramisù). Be natural and " +
        'appetizing, never add information. Reply with JSON only: {"name": "...", "description": "..."}.',
      messages: [{ role: "user", content: `Target language: ${target}\n${JSON.stringify(texts)}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const out = JSON.parse(match[0]) as Partial<Texts>;
    if (!out.name) return null;
    return { name: String(out.name).slice(0, 80), description: String(out.description ?? "").slice(0, 500) };
  } catch {
    return null;
  }
}
