import "server-only";
import { after } from "next/server";
import { clientIp } from "@/lib/http";
import { getTvRows } from "@/lib/tv/server";
import * as db from "@/lib/db/nocodb";
import { aiAvailable, aiModel } from "./ai";
import { estimateUsd } from "./cost";
import { runModeration, type ModerationDeps } from "./moderation";
import { assetInfo, createAparecaUpload, deleteMuxAsset } from "./mux-video";
import { aparecaOff } from "./off";
import { forgetSnapshot, getAparecaHead, getHouseVideos, monthUsage, readAparecaHeadFresh, type StoreDeps } from "./store";
import type { SubmitDeps } from "./submit";

// Dependências reais das rotas do cliente: NocoDB, Mux, cache do Next e after() para o que
// pode rodar depois da resposta (apagar vencido e chamar a moderação da IA).

// IA: interruptor do restaurante E chave E sem APARECA_OFF. A ANTHROPIC_API_KEY sozinha não liga nada.
const aiKey = () => process.env.ANTHROPIC_API_KEY || undefined;
const aiOn = (head: Parameters<typeof aiAvailable>[0]) => aiAvailable(head, { key: aiKey(), off: aparecaOff() });

function moderationDeps(): ModerationDeps {
  return {
    db,
    deleteAsset: deleteMuxAsset,
    key: aiKey(),
    model: aiModel(),
    off: aparecaOff,
    forget: forgetSnapshot,
    freshHead: readAparecaHeadFresh,
  };
}

// Mês do teto no fuso de Brasília (os restaurantes são daqui; o tally usa o fuso de cada casa).
const monthOf = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(now);

export function routeDeps(request: Request): SubmitDeps {
  const store: Pick<StoreDeps, "mux" | "defer"> = {
    mux: { deleteAsset: deleteMuxAsset },
    defer: (fn) => after(fn),
  };
  return {
    db,
    store,
    getHead: getAparecaHead,
    mux: { createUpload: createAparecaUpload, assetInfo },
    monthUsd: async () => estimateUsd(await monthUsage({ db, ...store }, monthOf(new Date()))),
    // O vídeo chega aqui já em pending ou ai_review (a duração foi conferida no settleUpload).
    // Só ai_review chama a IA; runModeration relê a linha e não grava sobre decisão já tomada.
    onReady: async (v, head) => {
      if (v.status === "ai_review") await runModeration(moderationDeps(), v, head);
    },
    aiOn,
    off: aparecaOff,
    // Como startVideoUpload: o Mux só aceita o PUT vindo desta origem.
    origin: request.headers.get("origin") ?? "*",
    ip: clientIp(request.headers),
    houseS: async (rid) =>
      (await getHouseVideos(rid))
        .filter((h) => h.active && h.status === "ready" && (h.duration_ms ?? 0) > 0)
        .map((h) => (h.duration_ms ?? 0) / 1000),
    tvs: getTvRows,
  };
}
