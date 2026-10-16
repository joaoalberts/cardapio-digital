import { describe, expect, it } from "vitest";
import { formatPrice } from "./media";

// Intl usa espaço inquebrável entre "R$" e o número; o teste compara com espaço comum.
const fp = (c: number, l = "pt-BR") => formatPrice(c, l).replace(/\s/g, " ");

describe("preço", () => {
  it("valor fechado sai sem ,00", () => {
    expect(fp(6400)).toBe("R$ 64");
    expect(fp(100000)).toBe("R$ 1.000");
  });
  it("valor com centavos mantém as duas casas", () => {
    expect(fp(5740)).toBe("R$ 57,40");
    expect(fp(2995)).toBe("R$ 29,95");
    expect(fp(5)).toBe("R$ 0,05");
  });
  it("vale nos outros idiomas também", () => {
    expect(fp(6400, "en")).toBe("R$64");
    expect(fp(5740, "en")).toBe("R$57.40");
  });
});

import { CARD_W, photoSrc, posterSrc, STORY_W, thumbSrc, videoSrc } from "./media";
import type { MenuItem, MenuMedia } from "./types";

const BLOB = "https://abc.public.blob.vercel-storage.com/r1/items/1.webp";
const photo = { id: "m1", kind: "photo", storage_path: BLOB, poster_path: null, mux_playback_id: null } as unknown as MenuMedia;
const video = { id: "m2", kind: "video", storage_path: null, poster_path: null, mux_playback_id: "pb" } as unknown as MenuMedia;

describe("fotos no tamanho da tela", () => {
  it("miniatura de card e lista sai reduzida (480)", () => {
    expect(thumbSrc({ media: [photo] } as unknown as MenuItem)).toBe(`/api/img?w=480&u=${encodeURIComponent(BLOB)}`);
    expect(thumbSrc({ media: [video] } as unknown as MenuItem)).toBe("https://image.mux.com/pb/thumbnail.jpg?width=480");
  });
  it("story em até 1440 e card na largura cheia do celular (sem perder resolução)", () => {
    expect(STORY_W).toBe(1440);
    expect(CARD_W).toBe(1080);
    expect(photoSrc(photo, STORY_W)).toBe(`/api/img?w=1440&u=${encodeURIComponent(BLOB)}`);
    expect(posterSrc(video, 828)).toBe("https://image.mux.com/pb/thumbnail.jpg?width=828");
    expect(posterSrc(video)).toBe("https://image.mux.com/pb/thumbnail.jpg");
  });
});

describe("vídeo", () => {
  it("card e banner usam o MP4 de 720p; story vai em streaming até Full HD", () => {
    const v = { ...video, mux_mp4: "720p.mp4" } as unknown as MenuMedia;
    expect(videoSrc(v, "card")).toBe("https://stream.mux.com/pb/720p.mp4");
    expect(videoSrc(v)).toBe("https://stream.mux.com/pb.m3u8");
  });
});
