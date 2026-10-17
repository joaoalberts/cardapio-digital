// Arranjo do palco do Apareça no telão, puro e testado. Tudo sai da mesma unidade do telão,
// --u = min(1vmin, 0,75vmax) (telao.css): 7,2 px em 720p, 10,8 em 1080p e na TV em pé, 21,6 em 4K,
// 7,68 em 4:3. O componente usa as constantes *_U em calc(var(--u) * N) e as proporções do clipe
// em %; os px daqui servem para os testes e para decidir o arranjo.
// - Deitada: o vídeo do cliente em 9:16 com a altura inteira da tela, centralizado; o logo numa
//   faixa do lado e o QR na outra; o nome embaixo, por cima do vídeo.
// - Em pé (ou quase quadrada, sem faixa para o QR): o clipe ocupa a largura toda e logo, QR e
//   nome ficam por cima do vídeo.

export const NAME_U = 4.4; // nome ou @ do cliente
export const QR_U = 22; // lado do QR (com a placa clara)
export const LOGO_U = 11; // logo da casa
// Faixa mínima do lado do clipe para o arranjo deitado: o QR com a placa escura (+3,2) e a margem (5), com folga.
export const SIDE_MIN_U = QR_U + 10;

const ASPECT = 9 / 16;

/** A --u do telão em px para uma tela w×h. */
export function stageUnit(w: number, h: number): number {
  return Math.min(Math.min(w, h) / 100, (0.75 * Math.max(w, h)) / 100);
}

export type StageLayout = {
  orientation: "landscape" | "portrait";
  clip: { w: number; h: number };
  nameFontPx: number;
  qrPx: number;
  logoPx: number;
};

export function stageLayout(width: number, height: number): StageLayout {
  const ok = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const w = ok ? width : 1280;
  const h = ok ? height : 720;
  const u = stageUnit(w, h);
  // 9:16 que cabe na tela, o mais alto possível (deitada: a altura toda; em pé: a largura toda).
  const clipH = Math.min(h, w / ASPECT);
  const clip = { w: clipH * ASPECT, h: clipH };
  const side = (w - clip.w) / 2;
  const orientation = w > h && side >= SIDE_MIN_U * u ? "landscape" : "portrait";
  return { orientation, clip, nameFontPx: NAME_U * u, qrPx: QR_U * u, logoPx: LOGO_U * u };
}

/** Espera até a próxima consulta da programação: 5 s no normal; 10, 20 e no máximo 30 s depois de falhas seguidas. */
export function nextDelay(failures: number): number {
  const n = Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0;
  return Math.min(30_000, 5_000 * 2 ** Math.min(n, 3));
}
