// Utilitários das rotas públicas (pedido, Apareça, TV): leitura do corpo com teto e o IP de quem chama.
// Sem nada do Next: funciona com o Request padrão e é testável no Vitest.

export type CappedBody = { ok: true; text: string } | { ok: false; status: 413 | 400 };

const DIGITS = /^\d{1,15}$/;

// Lê o corpo em fluxo, contando bytes, e para assim que passa de max (cancela o fluxo:
// o resto nunca é pedido). Recusa antes de ler quando o content-length já passa do teto.
// 413: grande demais. 400: content-length malformado, fluxo com erro, corpo já lido ou
// texto que não é UTF-8. Sem corpo, texto vazio.
export async function readBodyCapped(request: Request, max: number): Promise<CappedBody> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    const v = length.trim();
    if (!DIGITS.test(v)) return { ok: false, status: 400 };
    if (Number(v) > max) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, text: "" };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { ok: false, status: 400 };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 400 };
      }
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }

  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all) };
  } catch {
    return { ok: false, status: 400 };
  }
}

// JSON do corpo já lido; texto que não é JSON vira null (a validação de cada rota recusa).
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// IPv4 ou IPv6 em texto (até 45 caracteres). Qualquer outra coisa vira "anon".
const IP = /^[0-9a-fA-F:.]{2,45}$/;

// Primeiro IP do x-forwarded-for (na Vercel, o do cliente, posto pela própria plataforma).
// Sem cabeçalho ou com lixo, todos caem no mesmo balde "anon".
export function clientIp(headers: Headers): string {
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return IP.test(first) ? first : "anon";
}
