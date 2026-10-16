// Gravação no celular (usada pela tela do cliente): formato, limites, câmera e mensagens.
// Funções puras; quem chama passa o MediaRecorder.isTypeSupported e o userAgent.

export const CLIP_MS = 6_000;
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

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } },
  audio: true,
};

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
  no_camera: "Não encontramos a câmera frontal deste aparelho.",
  busy: "A câmera está sendo usada por outro aplicativo. Feche o outro aplicativo e tente de novo.",
  in_app: "Para gravar, abra este link no navegador: toque nos três pontinhos e escolha \"Abrir no navegador\".",
  too_big: "O vídeo ficou grande demais para enviar. Grave de novo.",
};
