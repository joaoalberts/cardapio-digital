/* eslint-disable @next/next/no-img-element -- JSX do next/og (satori), não é página */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { communityOff } from "@/lib/comunidade/off";
import { getCommunityContent, getCommunityHead } from "@/lib/comunidade/server";
import {
  parseStoryQuery,
  qrPath,
  resolveStory,
  storyAccent,
  storyCache,
  storyComeSize,
  storyHandle,
  storyImageSource,
  storyLead,
  storyTexts,
  storyTitleSize,
  withAlpha,
  type StoryDeps,
  type StorySource,
} from "@/lib/comunidade/story";
import type { VoteRow } from "@/lib/comunidade/types";
import * as db from "@/lib/db/nocodb";
import { getPublicMenu } from "@/lib/menu/data";
import { mediaUrl } from "@/lib/menu/media";
import { isValidSlug } from "@/lib/slug";
import { readLocalFile, storageDriver } from "@/lib/storage";

// Cartão do story 9:16 (ficha v2, telas 16 e 17): PNG 1080×1920 com o resultado da enquete
// (?poll=<id>) ou uma foto da casa (?post=<id>), a marca, "Vem pro <casa>", o @ e o QR de
// /<slug>?ref=story, tudo dentro das zonas seguras do Instagram. Sem desfoque: vira imagem. A CDN guarda o PNG (60 s com a enquete aberta, 1 dia encerrada, 1 h a foto da casa,
// que a casa pode ocultar).
//
// Fontes (SIL Open Font License 1.1), baixadas do repositório google/fonts no GitHub, sem
// modificação; a licença de cada uma está ao lado, como o repositório traz (OFL-*.txt), e o
// aviso de copyright vai também na tabela "name" de cada arquivo:
// - IMFellEnglish-Regular.ttf = ofl/imfellenglish/IMFeENrm28P.ttf (commit 90abd17b),
//   © 2010 Igino Marini, nome reservado "IM FELL English Roman".
// - Karla-Bold.ttf = ofl/karla/static/Karla-Bold.ttf, versão 2.002 (commit 568985db),
//   © 2019 The Karla Project Authors. A pasta static saiu do repositório em 2021, quando
//   ficou só a fonte variável, que o next/og desenha sempre no peso padrão.
// A logo do tema (Yesteryear, no protótipo) fica para depois: o nome da casa sai em IM Fell.
//
// Imagens: o next/og não desenha WebP (formato de todas as fotos do app). As fotos e a logo
// passam pelo sharp, o mesmo que o next/og já carrega para rasterizar quando está instalado
// (dependência opcional do Next): convertidas e já recortadas no tamanho da arte. Sem sharp,
// JPEG e PNG passam como estão e WebP fica de fora (a arte sai sem a foto).
//
// Tamanho: no máximo 1,5 MB (4G e o teto de 4,5 MB da resposta na Vercel). A foto entra a
// 2/3 do tamanho em que aparece (720×880; o next/og amplia e a parte de baixo já esmaece), e o
// PNG pronto passa de novo pelo sharp: sem perda com filtro adaptativo; se passar de 1,5 MB,
// com paleta de 256 cores (dither; texto e QR ficam iguais à vista) e, se ainda passar, de
// 128. Sem sharp, o PNG sai como o next/og fez.

const W = 1080;
const H = 1920;
// A foto aparece nos 1320 px de cima e esmaece no ônix.
const PHOTO_SHOWN_H = 1320;

const FG = "#f7efe6";
const INK = "#1b1714";
const BG = "#140e0b";
const CACHE_NOT_FOUND = "public, max-age=0, s-maxage=60";
const CACHE_ERROR = "public, max-age=0, s-maxage=5";
const NO_STORE = "no-store";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 5_000;
// Foto de fundo a 2/3 do tamanho em que aparece, ampliada pelo next/og; PNG final até 1,5 MB.
const PHOTO_W = 720;
const PHOTO_H = 880;
const PNG_TARGET_BYTES = 1_500_000;

type Ctx = { params: Promise<{ slug: string }> };

const deps: StoryDeps = {
  getHead: getCommunityHead,
  getContent: getCommunityContent,
  // Lidos na hora (sem cache), em ordem de gravação; story.ts filtra pelo restaurante.
  getVotes: (pollId) => db.list<VoteRow>("community_votes", { poll_id: pollId }, { sort: "Id" }),
  getMenu: (slug) => getPublicMenu(slug),
  off: communityOff,
};

// ---------- Fontes ----------

type Font = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let fonts: Promise<Font[]> | null = null;
function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all([
    readFile(join(process.cwd(), "src/app/api/comunidade/[slug]/story/IMFellEnglish-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/api/comunidade/[slug]/story/Karla-Bold.ttf")),
  ]).then(
    ([fell, karla]): Font[] => [
      { name: "IM Fell", data: fell, weight: 400, style: "normal" },
      { name: "Karla", data: karla, weight: 700, style: "normal" },
    ],
    (e) => {
      fonts = null;
      throw e;
    },
  );
  return fonts;
}

// ---------- Imagens ----------

type Sharp = (typeof import("sharp"))["default"];
let sharpMod: Promise<Sharp | null> | null = null;
const loadSharp = () => (sharpMod ??= import("sharp").then((m) => m.default, () => null));

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function readBytes(url: string): Promise<Uint8Array | null> {
  const where = storyImageSource(url, { local: storageDriver() === "local" });
  if (where === "local") {
    let parts: string[];
    try {
      parts = url.slice("/api/arquivos-locais/".length).split("/").map(decodeURIComponent);
    } catch {
      return null;
    }
    return (await readLocalFile(parts))?.body ?? null;
  }
  if (where !== "remote") return null;
  const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
  if (!res.ok) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.byteLength <= MAX_IMAGE_BYTES ? buf : null;
}

// Imagem pronta para a arte (data URL), recortada no tamanho em que aparece; null se não deu.
async function artImage(url: string | null, w: number, h: number, format: "jpeg" | "png"): Promise<string | null> {
  if (!url) return null;
  try {
    const bytes = await readBytes(url);
    if (!bytes) return null;
    const sharp = await loadSharp();
    if (sharp) {
      const img = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(w, h, { fit: "cover" });
      const out = format === "jpeg" ? await img.jpeg({ quality: 82 }).toBuffer() : await img.png().toBuffer();
      return `data:image/${format};base64,${out.toString("base64")}`;
    }
    if (isJpeg(bytes)) return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
    if (isPng(bytes)) return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    return null;
  } catch {
    return null;
  }
}

// PNG pronto mais leve, sem biblioteca nova: o sharp de novo (ver o topo). Qualquer falha
// devolve o PNG como veio.
async function smallerPng(png: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new Uint8Array(png);
  try {
    const sharp = await loadSharp();
    if (!sharp) return raw;
    let best: Uint8Array<ArrayBuffer> = raw;
    const lossless = new Uint8Array(await sharp(raw).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer());
    if (lossless.byteLength < best.byteLength) best = lossless;
    if (best.byteLength <= PNG_TARGET_BYTES) return best;
    for (const colours of [256, 128]) {
      const palette = new Uint8Array(await sharp(raw).png({ palette: true, colours, quality: 90, compressionLevel: 9 }).toBuffer());
      if (palette.byteLength < best.byteLength) best = palette;
      if (best.byteLength <= PNG_TARGET_BYTES) return best;
    }
    return best;
  } catch {
    return raw;
  }
}

// ---------- Rota ----------

export async function GET(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return new NextResponse(null, { status: 404, headers: { "cache-control": CACHE_NOT_FOUND } });
  const q = parseStoryQuery(request.nextUrl.searchParams);
  if (!q) return new NextResponse(null, { status: 400, headers: { "cache-control": NO_STORE } });

  let src: StorySource | null;
  try {
    src = await resolveStory(deps, slug, q);
  } catch {
    return new NextResponse(null, { status: 503, headers: { "cache-control": CACHE_ERROR } });
  }
  if (!src) return new NextResponse(null, { status: 404, headers: { "cache-control": CACHE_NOT_FOUND } });

  // O QR leva ao cardápio sem mesa, pelo mesmo endereço por onde a arte foi pedida.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const link = `${proto}://${host}/${slug}?ref=story`;

  try {
    const photoUrl = src.kind === "poll" ? src.photo : src.post.photo_path;
    // Miniaturas só das perdedoras (a vencedora já é a foto grande).
    const lead = src.kind === "poll" ? storyLead(src.poll) : null;
    const thumbIds = src.kind === "poll" ? src.poll.options.filter((o) => o.id !== lead && src.thumbs[o.id]).map((o) => o.id) : [];
    const [font, photo, logo, ...thumbImgs] = await Promise.all([
      loadFonts(),
      artImage(photoUrl, PHOTO_W, PHOTO_H, "jpeg"),
      artImage(mediaUrl(src.head.logo_path), 208, 208, "png"),
      ...thumbIds.map((id) => artImage(src.kind === "poll" ? (src.thumbs[id] ?? null) : null, 116, 116, "jpeg")),
    ]);
    const thumbs = Object.fromEntries(thumbIds.map((id, i) => [id, thumbImgs[i]]));
    const qr = QRCode.create(link, { errorCorrectionLevel: "M" });
    const art = (
      <Art src={src} photo={photo} logo={logo} thumbs={thumbs} qr={{ size: qr.modules.size, d: qrPath(qr.modules.size, (r, c) => !!qr.modules.get(r, c)) }} />
    );
    // Desenha antes de responder, para um erro virar 503 em vez de um PNG cortado.
    const png = await smallerPng(await new ImageResponse(art, { width: W, height: H, fonts: font }).arrayBuffer());
    return new NextResponse(png, {
      headers: {
        "content-type": "image/png",
        "cache-control": storyCache(src, new Date()),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error("story: falha ao desenhar", e);
    return new NextResponse(null, { status: 503, headers: { "cache-control": CACHE_ERROR } });
  }
}

// ---------- Arte ----------
// Ficha v2 (tela 16): a foto da vencedora sangra no alto (1320 px) e esmaece no ônix; a marca
// em y 270; o resultado termina em y ~1300 e cresce para cima; o rodapé de y 1404 a 1620 com
// "Vem pro <casa>", o @, o convite e o QR. Tudo entre y 270 e 1620, fora do que o Instagram
// cobre (0–250 em cima e 1670–1920 embaixo, tela 17).

const SIDE = 84;
const MUTED = "rgba(247,239,230,0.68)";
const SP_LINE = "linear-gradient(90deg, rgba(184,165,130,0) 0%, #b8a582 22%, #fff8ea 50%, #b8a582 78%, rgba(184,165,130,0) 100%)";
const VEIL =
  "linear-gradient(180deg, rgba(20,14,11,0.74) 0%, rgba(20,14,11,0.5) 13%, rgba(20,14,11,0) 25%, rgba(20,14,11,0) 34%, rgba(20,14,11,0.72) 48%, rgba(20,14,11,0.94) 60%, #140e0b 70%)";

type ArtProps = {
  src: StorySource;
  photo: string | null;
  logo: string | null;
  thumbs: Partial<Record<string, string | null>>;
  qr: { size: number; d: string };
};

function Art({ src, photo, logo, thumbs, qr }: ArtProps) {
  const accent = storyAccent(src.head.brand_color);
  const t = storyTexts(src);
  const handle = storyHandle(src.head.instagram);
  const name = src.head.name || src.head.slug;
  const poll = src.kind === "poll" ? src.poll : null;
  const lead = poll ? storyLead(poll) : null;
  const leadOpt = poll?.options.find((o) => o.id === lead) ?? null;
  const rest = poll ? poll.options.filter((o) => o.id !== lead).sort((a, b) => b.pct - a.pct) : [];
  const come = storyComeSize(t.come);
  const titleSize = storyTitleSize(t.title);

  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", background: BG, color: FG, fontFamily: "Karla", fontWeight: 700 }}>
      {photo ? (
        <img src={photo} width={W} height={PHOTO_SHOWN_H} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: PHOTO_SHOWN_H, objectFit: "cover" }} />
      ) : (
        // Sem foto: um brilho discreto da cor da casa no alto.
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: W,
            height: PHOTO_SHOWN_H,
            backgroundImage: `radial-gradient(circle at 30% 30%, ${withAlpha(accent, 0.3)} 0%, rgba(20,14,11,0) 60%)`,
          }}
        />
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: VEIL }} />

      {/* Marca: logo com aro da casa, nome e @. */}
      <div style={{ position: "absolute", left: SIDE, right: SIDE, top: 270, display: "flex", alignItems: "center" }}>
        <div style={{ width: 112, height: 112, borderRadius: 999, background: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {logo ? (
            <img src={logo} width={104} height={104} alt="" style={{ width: 104, height: 104, borderRadius: 999 }} />
          ) : (
            <div style={{ width: 104, height: 104, borderRadius: 999, background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "IM Fell", fontWeight: 400, fontSize: 56, color: accent }}>
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 24, minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "IM Fell", fontWeight: 400, fontSize: 58, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
          {handle && <div style={{ fontSize: 36, marginTop: 8 }}>{handle}</div>}
        </div>
      </div>

      {/* Resultado (ou a foto da casa): termina em y ~1300 e cresce para cima. */}
      <div style={{ position: "absolute", left: SIDE, right: SIDE, bottom: H - 1300, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 32, color: accent }}>{t.kicker}</div>
        {t.question && <div style={{ marginTop: 12, fontFamily: "IM Fell", fontWeight: 400, fontSize: 40, lineHeight: 1.1, color: MUTED }}>{t.question}</div>}
        <div style={{ marginTop: 6, fontFamily: "IM Fell", fontWeight: 400, fontSize: titleSize, lineHeight: 0.98 }}>{t.title}</div>
        {poll && leadOpt && (
          <div style={{ display: "flex", alignItems: "center", marginTop: 30 }}>
            <div style={{ display: "flex", alignItems: "baseline", color: accent, fontSize: 160, lineHeight: 0.85, letterSpacing: -6 }}>
              {String(leadOpt.pct)}
              <span style={{ fontSize: 90, letterSpacing: 0, marginLeft: 4 }}>%</span>
            </div>
            {rest.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 44 }}>
                {rest.map((o, i) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", marginTop: i ? 14 : 0, fontSize: 38, color: MUTED }}>
                    {thumbs[o.id] && <img src={thumbs[o.id] as string} width={58} height={58} alt="" style={{ width: 58, height: 58, borderRadius: 14, marginRight: 16 }} />}
                    <div style={{ display: "flex", maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</div>
                    <div style={{ display: "flex", marginLeft: 14, color: FG }}>{`${o.pct}%`}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {t.sub && (
          <div style={{ display: "flex", alignItems: "center", marginTop: 22, fontSize: 38, color: MUTED }}>
            <Star color={accent} size={36} />
            <div style={{ marginLeft: 12 }}>{t.sub}</div>
          </div>
        )}
        <div style={{ height: 2, marginTop: 46, backgroundImage: SP_LINE, opacity: 0.8 }} />
      </div>

      {/* Rodapé: fala com quem não está na casa, e o QR creme (abre /<slug>?ref=story). */}
      <div style={{ position: "absolute", left: SIDE, right: SIDE, top: 1404, height: 216, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, marginRight: 36 }}>
          <div style={{ fontFamily: "IM Fell", fontWeight: 400, fontSize: come.size, lineHeight: 1 }}>{come.text}</div>
          {handle && <div style={{ fontSize: 50, marginTop: 12 }}>{handle}</div>}
          <div style={{ fontSize: 30, color: MUTED, marginTop: 6 }}>{t.point}</div>
        </div>
        <div style={{ display: "flex", width: 196, height: 196, padding: 18, borderRadius: 22, background: FG, flexShrink: 0 }}>
          <svg width={160} height={160} viewBox={`0 0 ${qr.size} ${qr.size}`}>
            <path d={qr.d} fill={INK} />
          </svg>
        </div>
      </div>
    </div>
  );
}

// Estrela do destaque desenhada (a fonte da arte não tem o caractere ★).
function Star({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill={color} />
    </svg>
  );
}
