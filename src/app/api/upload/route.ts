import { NextResponse, type NextRequest } from "next/server";
import { isMember } from "@/lib/auth";
import { putFile, storageEnabled } from "@/lib/storage";

// Fotos, capas de vídeo e logos do painel: o navegador manda o arquivo já reduzido e
// o servidor grava no Vercel Blob, na pasta do restaurante (com STORAGE_DRIVER=local, em .local-blob/).
// A Vercel limita o corpo do pedido a 4,5 MB; as fotos chegam bem menores.
const MAX_BYTES = 4_400_000;
const TYPES = /^(image\/(png|jpeg|webp)|video\/(mp4|quicktime|webm))$/;
const NAME = /^(items|categories|cover|logo)\/[\w.-]{1,80}$/;

export async function POST(request: NextRequest) {
  const restaurantId = request.nextUrl.searchParams.get("restaurant") ?? "";
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const type = request.headers.get("content-type") ?? "";
  if (!NAME.test(name) || name.includes("..") || !TYPES.test(type)) {
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  }
  if (!(await isMember(restaurantId))) return NextResponse.json({ error: "Entre de novo no painel." }, { status: 401 });
  if (!storageEnabled()) {
    return NextResponse.json({ error: "O envio de arquivos ainda não está ligado neste sistema." }, { status: 503 });
  }
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo grande demais. Envie até 4 MB." }, { status: 413 });
  }
  try {
    const url = await putFile(`${restaurantId}/${name}`, body, type);
    return NextResponse.json({ url });
  } catch (e) {
    console.error("upload", String(e).slice(0, 300));
    return NextResponse.json({ error: "Não foi possível enviar o arquivo. Tente de novo." }, { status: 502 });
  }
}
