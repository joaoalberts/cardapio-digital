import { NextResponse, type NextRequest } from "next/server";
import { readCalls } from "@/lib/db/call-counter";
import { readLocalFile, storageDriver } from "@/lib/storage";

// Só para teste local e Docker (STORAGE_DRIVER=local): serve as fotos que o driver local
// gravou em .local-blob/. Fora desse modo, responde 404 como se a rota não existisse.
// O caminho é conferido em readLocalFile: nada de "..", e só webp, jpg e png.
// /_calls devolve o contador de chamadas ao NocoDB (call-counter.ts), só com NOCODB_COUNT=1.

type Ctx = { params: Promise<{ path: string[] }> };

const NOT_FOUND = () => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(_request: NextRequest, { params }: Ctx) {
  if (storageDriver() !== "local") return NOT_FOUND();
  const parts = (await params).path ?? [];
  if (parts.length === 1 && parts[0] === "_calls") {
    const calls = readCalls();
    return calls ? NextResponse.json(calls, { headers: { "cache-control": "no-store" } }) : NOT_FOUND();
  }
  const file = await readLocalFile(parts);
  if (!file) return NOT_FOUND();
  return new NextResponse(file.body, {
    headers: { "content-type": file.type, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
