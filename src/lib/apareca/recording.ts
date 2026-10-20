// Gravação no celular (usada pela tela do cliente): formato, limites, câmera e mensagens.
// Funções puras; quem chama passa o MediaRecorder.isTypeSupported e o userAgent.

export const CLIP_MS = 6_000; // máximo; o cliente pode parar antes
export const MIN_CLIP_MS = 1_000; // o botão de parar só funciona depois disso
export const MAX_BYTES = 8 * 1024 * 1024;
export const REDO_MAX = 3;

// iPhone grava mp4 (H.264); Android, webm. O Mux converte qualquer um.
const MIMES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function pickMime(isSupported: (t: string) => boolean): string | null {
  for (const t of MIMES) {
    try {
      if (isSupported(t)) return t;
    } catch {
      // navegador que lança ao perguntar conta como "não aceita"
    }
  }
  return null;
}

// Navegadores dentro de app costumam negar a câmera sem perguntar. O Instagram vem antes
// porque o UA dele às vezes também traz marcas do Facebook.
export function inAppBrowser(ua: string): "instagram" | "whatsapp" | "facebook" | null {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/WhatsApp/i.test(ua)) return "whatsapp";
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return "facebook";
  return null;
}

export type Facing = "user" | "environment";

// facingMode como texto é só preferência: aparelho sem câmera traseira (computador) abre a que tiver.
// Na traseira não pedimos 9:16: o celular recorta o sensor para caber e a imagem chega com zoom.
// Pedimos o quadro nativo (16:9 deitado, que o celular em pé entrega em pé) e a tela recorta.
export function cameraConstraints(facing: Facing): MediaStreamConstraints {
  const video: MediaTrackConstraints =
    facing === "user"
      ? { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } }
      : { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } };
  return { video, audio: true };
}

// Zoom da câmera (Chrome no Android e Safari recente expõem): volta a 1x se abriu com zoom.
// Fica dentro do intervalo do aparelho; sem suporte, retorna null e nada muda.
export function zoomReset(cap: { min?: number; max?: number } | undefined, current: number | undefined): number | null {
  if (!cap || typeof cap.min !== "number" || typeof cap.max !== "number") return null;
  const target = Math.min(cap.max, Math.max(cap.min, 1));
  return typeof current === "number" && Math.abs(current - target) < 0.01 ? null : target;
}

export const CAMERA_CONSTRAINTS = cameraConstraints("user");

// Erro do getUserMedia → problema que a tela explica. Sem navigator.mediaDevices (http fora
// do localhost ou navegador antigo) o acesso vira TypeError, que cai em "unsupported".
export function recordingProblem(e: unknown): "denied" | "unsupported" | "no_camera" | "busy" {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "no_camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "unsupported";
}

export const PROBLEM_TEXT: Record<"denied" | "unsupported" | "no_camera" | "busy" | "in_app" | "too_big", string> = {
  denied: "Você não liberou a câmera. Toque no cadeado da barra de endereço, permita a câmera e tente de novo.",
  unsupported: "Este navegador não grava vídeo. Abra o cardápio no Safari (iPhone) ou no Chrome (Android).",
  no_camera: "Não encontramos a câmera deste aparelho.",
  busy: "A câmera está sendo usada por outro aplicativo. Feche o outro aplicativo e tente de novo.",
  in_app: "Para gravar, abra este link no navegador: toque nos três pontinhos e escolha \"Abrir no navegador\".",
  too_big: "O vídeo ficou grande demais para enviar. Grave de novo.",
};

// ---------- Fluxo da tela do cliente (puro) ----------
// intro (nome e aceite) → câmera → contagem 3, 2, 1 → gravando até 6 s → revisão → enviando → fila.
// O cliente pode parar antes dos 6 s; abaixo de MIN_CLIP_MS a gravação é descartada e volta à câmera.
// A revisão permite REDO_MAX regravações; depois disso o botão some (canRedo). Erro no envio volta
// à revisão com o mesmo vídeo e o aviso (sendError). Um problema (câmera, tamanho) leva à tela de
// problema; "tentar de novo" reabre a câmera ou, se o vídeo ficou grande, grava de novo sem gastar
// regravação. "Cancelar" volta ao intro (sem devolver regravações). O que acontece na fila (posição, TV) vem do servidor e não passa por aqui.

export type ProblemKey = keyof typeof PROBLEM_TEXT;
export type FlowStep = "intro" | "camera" | "countdown" | "recording" | "review" | "sending" | "queue" | "problem";
export type FlowState = { step: FlowStep; redos: number; count: number; problem?: ProblemKey; sendError?: boolean };
export type FlowEvent =
  | { type: "consent_ok" }
  | { type: "ready" }
  | { type: "tick" }
  | { type: "elapsed"; ms: number; bytes: number }
  | { type: "redo" }
  | { type: "send" }
  | { type: "sent" }
  | { type: "send_failed" }
  | { type: "problem"; problem: ProblemKey }
  | { type: "retry" }
  | { type: "cancel" }
  | { type: "again" };

export const COUNTDOWN_FROM = 3;
export const FLOW_START: FlowState = { step: "intro", redos: 0, count: 0 };

export const canRedo = (s: Pick<FlowState, "redos">) => s.redos < REDO_MAX;

const countdown = (s: FlowState, redos = s.redos): FlowState => ({ step: "countdown", redos, count: COUNTDOWN_FROM });

export function flowNext(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "consent_ok":
      return s.step === "intro" ? { ...s, step: "camera" } : s;
    case "ready":
      return s.step === "camera" ? countdown(s) : s;
    case "tick":
      if (s.step !== "countdown") return s;
      return s.count > 1 ? { ...s, count: s.count - 1 } : { ...s, step: "recording", count: 0 };
    case "elapsed":
      if (s.step !== "recording") return s;
      if (e.ms < MIN_CLIP_MS) return { step: "camera", redos: s.redos, count: 0 };
      if (e.bytes > MAX_BYTES) return { ...s, step: "problem", problem: "too_big" };
      return { ...s, step: "review", sendError: false };
    case "redo":
      return s.step === "review" && canRedo(s) ? countdown(s, s.redos + 1) : s;
    case "send":
      return s.step === "review" ? { ...s, step: "sending", sendError: false } : s;
    case "sent":
      return s.step === "sending" ? { step: "queue", redos: s.redos, count: 0 } : s;
    case "send_failed":
      return s.step === "sending" ? { ...s, step: "review", sendError: true } : s;
    case "problem":
      return s.step === "queue" || s.step === "sending" ? s : { ...s, step: "problem", problem: e.problem };
    case "retry":
      if (s.step !== "problem") return s;
      if (s.problem === "too_big") return countdown(s);
      return { step: "camera", redos: s.redos, count: 0 };
    case "cancel":
      // Envio em andamento e fila não voltam: o vídeo já saiu (ou está saindo) do celular.
      return s.step === "sending" || s.step === "queue" || s.step === "intro" ? s : { step: "intro", redos: s.redos, count: 0 };
    case "again":
      // Outro vídeo depois de enviar: começa do zero, com as regravações de volta. Depois de
      // recarregar a página a fila aparece com o fluxo ainda no intro, que também vale.
      return s.step === "queue" || s.step === "intro" ? FLOW_START : s;
  }
}
