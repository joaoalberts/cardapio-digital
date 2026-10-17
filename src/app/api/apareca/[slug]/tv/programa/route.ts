import { after, NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { deleteMuxAsset } from "@/lib/apareca/mux-video";
import { aparecaOff } from "@/lib/apareca/off";
import { programFor } from "@/lib/apareca/schedule";
import { getAparecaHead, getHouseVideos, readSnapshot, type StoreDeps } from "@/lib/apareca/store";
import { flushHouseIfDue, heartbeat, identifyTv, tvFeatureOn, type AparecaTvDeps } from "@/lib/apareca/tv";
import { readBodyCapped } from "@/lib/comunidade/http";
import { QR_ECC, qrLink } from "@/lib/comunidade/qr";
import * as db from "@/lib/db/nocodb";
import { mediaUrl } from "@/lib/menu/media";
import { isValidSlug } from "@/lib/slug";

// Programação do Apareça para uma TV pareada pela Comunidade. POST com o segredo no cabeçalho
// x-telao (nunca em cookie nem na URL); só vale no restaurante do slug. 401: segredo que não é
// de uma TV pareada deste restaurante (ou revogada); 404: slug sem restaurante. Cada consulta é
// também o sinal de vida (gravado no máx. 1x por minuto, depois da resposta).
// Feature fora do ar (featureState não "on") → { enabled: false, program: null }. A pausa do teto
// do Mux só para os envios: o que já foi aprovado continua tocando.
// Resposta: { enabled, program, logo, qr }; qr é o SVG de /<slug>?ref=telao, o mesmo do telão.
const deps: AparecaTvDeps = { db, getHead: getAparecaHead, off: aparecaOff };
const store: StoreDeps = { db, mux: { deleteAsset: deleteMuxAsset }, defer: (fn) => after(fn) };
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 2_000;

// QR gerado uma vez por instância para cada endereço (as mesmas opções do telão).
const qrs = new Map<string, Promise<string>>();
function qrSvg(link: string): Promise<string> {
  let p = qrs.get(link);
  if (!p) {
    const fresh = QRCode.toString(link, {
      type: "svg", margin: 0, errorCorrectionLevel: QR_ECC, color: { dark: "#1b1714", light: "#0000" },
    });
    fresh.catch(() => {
      if (qrs.get(link) === fresh) qrs.delete(link);
    });
    qrs.set(link, fresh);
    p = fresh;
  }
  return p;
}

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) return NextResponse.json({ ok: false, code: "not_found" }, { status: 404, headers: NO_STORE });
  const read = await readBodyCapped(request, MAX_BODY);
  if (!read.ok) return NextResponse.json({ ok: false, code: "invalid" }, { status: read.status, headers: NO_STORE });
  try {
    const tv = await identifyTv(deps, slug, request.headers.get("x-telao"));
    if ("status" in tv) {
      const code = tv.status === 401 ? "unauthorized" : "not_found";
      return NextResponse.json({ ok: false, code }, { status: tv.status, headers: NO_STORE });
    }
    // Depois da resposta, melhor esforço: o sinal de vida e a soma de institucionais parada há 10 min.
    after(async () => {
      await heartbeat(deps, tv).catch(() => {});
      await flushHouseIfDue(deps, tv.restaurantId);
    });

    const head = await getAparecaHead(slug);
    // O mesmo host pelo qual a TV abriu, como no telão.
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const proto = request.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
    const qr = await qrSvg(qrLink(proto, host, slug, "telao"));

    if (!head || !tvFeatureOn(deps, head)) {
      return NextResponse.json({ enabled: false, program: null, logo: null, qr }, { headers: NO_STORE });
    }
    const [snap, house] = await Promise.all([readSnapshot(store, head.id), getHouseVideos(head.id)]);
    const program = programFor({ cfg: head.config, tvZone: tv.zone, videos: snap.videos, house });
    return NextResponse.json({ enabled: true, program, logo: mediaUrl(head.logo_path), qr }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false, code: "error" }, { status: 503, headers: NO_STORE });
  }
}
