import type { PollTemplate } from "@/lib/comunidade/types";

// Peças visuais usadas pelo editor da Comunidade e pelos componentes que saíram dele
// (Nova enquete, Foto de prato), para a tela "Agora" reaproveitar sem copiar.

export const TPL: Record<PollTemplate, { emoji: string; name: string }> = {
  dessert: { emoji: "🍰", name: "Sobremesa" },
  drink: { emoji: "🍹", name: "Bebida" },
  music: { emoji: "🎵", name: "Música" },
  custom: { emoji: "💬", name: "Personalizada" },
};

export const ICONS = {
  chat: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.3A8 8 0 1121 12z",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z",
  tv: "M5 5h14a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0119 17H5a2.5 2.5 0 01-2.5-2.5v-7A2.5 2.5 0 015 5zM8 21h8M12 17v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  plus: "M12 5v14M5 12h14",
};
export function Icon({ d }: { d: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  );
}
