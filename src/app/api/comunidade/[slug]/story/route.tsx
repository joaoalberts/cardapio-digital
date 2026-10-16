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
  storyHandle,
  storyImageSource,
  storyLead,
  storyTexts,
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

// Cartão do story 9:16 (ficha do protótipo: telas 15 e 16): PNG 1080×1920 com o resultado
// da enquete (?poll=<id>) ou uma foto da casa (?post=<id>), a marca, o @ e o QR de
// /<slug>?ref=story. A arte do protótipo tem 288×512; aqui tudo é ×3,75. Sem desfoque: vira
// imagem. A CDN guarda o PNG (60 s com a enquete aberta; 1 dia encerrada ou foto da casa).
//
// Fontes (SIL Open Font License 1.1), baixadas do repositório google/fonts no GitHub, sem
// modificação; o aviso de copyright e a licença vão na tabela "name" de cada arquivo:
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

const W = 1080;
const H = 1920;
const S = 3.75; // escala da arte do protótipo (288×512) para 1080×1920
const px = (n: number) => Math.round(n * S);

const FG = "#f7efe6";
const INK = "#1b1714";
const BG = "#1c1511";
const PHOTO_GLASS = "rgba(26, 20, 16, 0.55)";
// Sombra leve no texto que pode cair sobre a foto (rótulo e pergunta), para ler em qualquer prato.
const TEXT_SHADOW = "0 2px 14px rgba(0, 0, 0, 0.5)";
const CACHE_NOT_FOUND = "public, max-age=0, s-maxage=60";
const CACHE_ERROR = "public, max-age=0, s-maxage=5";
const NO_STORE = "no-store";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 5_000;

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
    const [font, photo, logo] = await Promise.all([
      loadFonts(),
      artImage(photoUrl, W, H, "jpeg"),
      artImage(mediaUrl(src.head.logo_path), 144, 144, "png"),
    ]);
    const qr = QRCode.create(link, { errorCorrectionLevel: "M" });
    const art = (
      <Art src={src} photo={photo} logo={logo} qr={{ size: qr.modules.size, d: qrPath(qr.modules.size, (r, c) => !!qr.modules.get(r, c)) }} />
    );
    // Desenha antes de responder, para um erro virar 503 em vez de um PNG cortado.
    const png = await new ImageResponse(art, { width: W, height: H, fonts: font }).arrayBuffer();
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

function Art({ src, photo, logo, qr }: { src: StorySource; photo: string | null; logo: string | null; qr: { size: number; d: string } }) {
  const accent = storyAccent(src.head.brand_color);
  const t = storyTexts(src);
  const handle = storyHandle(src.head.instagram);
  const name = src.head.name || src.head.slug;
  const poll = src.kind === "poll" ? src.poll : null;
  // Sombra de baixo: na enquete, sobe mais cedo (pergunta e barras); na foto, deixa o prato.
  const shade =
    src.kind === "poll"
      ? "linear-gradient(180deg, rgba(20,14,11,0.35) 0%, rgba(20,14,11,0) 22%, rgba(28,22,18,0.25) 34%, rgba(28,22,18,0.93) 52%, #1c1511 100%)"
      : "linear-gradient(180deg, rgba(20,14,11,0.4) 0%, rgba(20,14,11,0) 22%, rgba(20,14,11,0) 46%, rgba(28,22,18,0.88) 70%, #1c1511 100%)";
  const lead = poll ? storyLead(poll) : null;

  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", background: BG, color: FG, fontFamily: "Karla", fontWeight: 700 }}>
      {photo ? (
        <img src={photo} width={W} height={H} alt="" style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover" }} />
      ) : (
        // Sem foto: um brilho discreto da cor da casa no alto.
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: W,
            height: H,
            backgroundImage: `radial-gradient(circle at 30% 18%, ${withAlpha(accent, 0.32)} 0%, rgba(28,22,18,0) 55%)`,
          }}
        />
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: shade }} />

      {/* Marca em vidro no topo: logo com aro da casa, nome e @. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: px(18), display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: px(46),
            padding: `0 ${px(16)}px 0 ${px(5)}px`,
            borderRadius: px(23),
            background: PHOTO_GLASS,
          }}
        >
          <div
            style={{
              width: px(36) + 12,
              height: px(36) + 12,
              borderRadius: 999,
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginRight: px(9),
            }}
          >
            {logo ? (
              <img src={logo} width={px(36)} height={px(36)} alt="" style={{ width: px(36), height: px(36), borderRadius: 999 }} />
            ) : (
              <div
                style={{
                  width: px(36),
                  height: px(36),
                  borderRadius: 999,
                  background: BG,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "IM Fell",
                  fontWeight: 400,
                  fontSize: px(20),
                  color: accent,
                }}
              >
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <div style={{ fontFamily: "IM Fell", fontWeight: 400, fontSize: px(19), maxWidth: px(190), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {name}
            </div>
            {handle && <div style={{ fontSize: px(11.5), color: "rgba(247,239,230,0.78)", marginTop: 6 }}>{handle}</div>}
          </div>
        </div>
      </div>

      {/* Corpo: rótulo, pergunta (ou nome do prato) e as barras em %. */}
      <div
        style={{
          position: "absolute",
          left: px(18),
          right: px(18),
          bottom: px(poll ? 102 : 108),
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: px(12), color: accent, textShadow: TEXT_SHADOW }}>{t.kicker}</div>
        {poll ? (
          <div style={{ marginTop: px(8), fontFamily: "IM Fell", fontWeight: 400, fontSize: px(27), lineHeight: 1.08, textWrap: "balance", textShadow: TEXT_SHADOW }}>
            {t.title}
          </div>
        ) : (
          <div style={{ marginTop: px(8), fontFamily: "IM Fell", fontWeight: 400, fontSize: px(38), lineHeight: 1, textShadow: TEXT_SHADOW }}>{t.title}</div>
        )}
        {poll?.options.map((o) => (
          <div
            key={o.id}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: px(8),
              height: px(32),
              padding: `0 ${px(11)}px`,
              borderRadius: px(11),
              overflow: "hidden",
              background: "rgba(255,255,255,0.08)",
              fontSize: px(13),
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${o.pct}%`,
                backgroundImage:
                  o.id === lead
                    ? `linear-gradient(90deg, ${withAlpha(accent, 0.6)}, ${withAlpha(accent, 0.34)})`
                    : "linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.1))",
              }}
            />
            <div style={{ display: "flex", flex: 1, minWidth: 0, marginRight: px(10), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.label}
            </div>
            <div style={{ display: "flex" }}>{`${o.pct}%`}</div>
          </div>
        ))}
        {t.sub && (
          <div style={{ display: "flex", alignItems: "center", marginTop: px(8), fontSize: px(13.5), color: "rgba(247,239,230,0.8)" }}>
            <Star color={accent} size={px(13.5)} />
            <div style={{ marginLeft: px(5) }}>{t.sub}</div>
          </div>
        )}
      </div>

      {/* Pé: QR creme (abre /<slug>?ref=story) e o convite. */}
      <div style={{ position: "absolute", left: px(18), right: px(18), bottom: px(18), display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", width: px(72), height: px(72), padding: px(5), borderRadius: px(12), background: FG, flexShrink: 0 }}>
          <svg width={px(62)} height={px(62)} viewBox={`0 0 ${qr.size} ${qr.size}`}>
            <path d={qr.d} fill={INK} />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, marginLeft: px(12), lineHeight: 1.2 }}>
          {/* Numa linha, como no protótipo (a IM Fell aqui é um pouco mais larga que no navegador). */}
          <div style={{ fontFamily: "IM Fell", fontWeight: 400, fontSize: px(16.5), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.foot}
          </div>
          <div style={{ fontSize: px(12), color: "rgba(247,239,230,0.72)", marginTop: 4 }}>{t.footSub}</div>
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
