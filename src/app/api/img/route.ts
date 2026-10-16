import sharp from "sharp";
import { type NextRequest } from "next/server";
import { imgHostAllowed, isProxiable, parseImgQuery } from "@/lib/images/sized";

// Foto reduzida para o tamanho em que aparece (sizedSrc em src/lib/images/sized.ts).
// Os arquivos nunca mudam de conteúdo (cada envio ganha nome novo), então a resposta
// fica no cache da Vercel e do celular por um ano: a redução roda uma vez por tamanho.
const MAX_BYTES = 20_000_000;
const HEADERS = { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" };

// Guarda na memória do servidor as fotos já reduzidas (até ~60 MB): o mesmo pedido de
// novo sai na hora, sem baixar e reduzir outra vez. Pedidos iguais ao mesmo tempo
// esperam a mesma redução. Na Vercel o cache da CDN já faz isso; aqui cobre o servidor
// recém-ligado e a cópia local.
const MEM_MAX = 60_000_000;
const mem = new Map<string, Uint8Array>();
let memBytes = 0;
const pending = new Map<string, Promise<Uint8Array | null>>();
function remember(key: string, out: Uint8Array) {
  mem.set(key, out);
  memBytes += out.byteLength;
  for (const [k, v] of mem) {
    if (memBytes <= MEM_MAX) break;
    mem.delete(k);
    memBytes -= v.byteLength;
  }
}
const send = (out: Uint8Array) => new Response(out as BodyInit, { headers: { ...HEADERS, "content-length": String(out.byteLength) } });

export async function GET(request: NextRequest) {
  const q = parseImgQuery(request.nextUrl.searchParams);
  if (!q) return new Response("bad request", { status: 400 });
  const env = {
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    extraHosts: process.env.IMG_HOSTS,
  };
  if (!imgHostAllowed(q.url, env)) {
    // Foto de um store que este servidor não conhece (cópia local, prévia sem o Blob):
    // manda para o original, que é o que o cardápio mostrava antes.
    return isProxiable(q.url.href) ? Response.redirect(q.url, 302) : new Response("forbidden", { status: 403 });
  }

  const key = `${q.w}|${q.url.href}`;
  const hit = mem.get(key);
  if (hit) {
    // Mais usada por último fica no fim (sai por último quando a memória enche).
    mem.delete(key);
    mem.set(key, hit);
    return send(hit);
  }
  let job = pending.get(key);
  if (!job) {
    job = shrink(q.url, q.w).finally(() => pending.delete(key));
    pending.set(key, job);
  }
  const out = await job;
  // Sem foto reduzida (original grande demais, formato que o sharp não lê, falha na
  // busca): entrega o original.
  if (!out) return Response.redirect(q.url, 302);
  return send(out);
}

async function shrink(url: URL, w: number): Promise<Uint8Array | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!res?.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const input = Buffer.from(await res.arrayBuffer());
  if (input.byteLength > MAX_BYTES) return null;
  try {
    const buf = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 84, effort: 4, smartSubsample: true })
      .toBuffer();
    const out = new Uint8Array(buf);
    remember(`${w}|${url.href}`, out);
    return out;
  } catch {
    return null;
  }
}
