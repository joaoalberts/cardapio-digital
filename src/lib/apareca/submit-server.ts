import "server-only";
import { after } from "next/server";
import { clientIp } from "@/lib/comunidade/http";
import { getCommunityContent } from "@/lib/comunidade/server";
import * as db from "@/lib/db/nocodb";
import { estimateUsd } from "./cost";
import { assetInfo, createAparecaUpload, deleteMuxAsset } from "./mux-video";
import { aparecaOff } from "./off";
import { getAparecaHead, getHouseVideos, monthUsage, type StoreDeps } from "./store";
import type { SubmitDeps } from "./submit";

// Dependências reais das rotas do cliente: NocoDB, Mux, cache do Next e after() para o que
// pode rodar depois da resposta (apagar vencido e chamar onReady).

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
    // T9 liga a moderação aqui; até lá o vídeo fica "pending" e vai para a fila manual.
    onReady: async () => {},
    off: aparecaOff,
    // Como startVideoUpload: o Mux só aceita o PUT vindo desta origem.
    origin: request.headers.get("origin") ?? "*",
    ip: clientIp(request.headers),
    houseS: async (rid) =>
      (await getHouseVideos(rid))
        .filter((h) => h.active && h.status === "ready" && (h.duration_ms ?? 0) > 0)
        .map((h) => (h.duration_ms ?? 0) / 1000),
    community: async (rid) => {
      const c = await getCommunityContent(rid);
      return { polls: c.polls, tvs: c.tvs };
    },
  };
}
