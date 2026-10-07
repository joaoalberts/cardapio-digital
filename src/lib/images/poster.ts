import { shrinkImage } from "./shrink";

export const VIDEO_TYPES = /^video\/(mp4|quicktime|webm)$/;

// Capa do vídeo: um quadro do início, tirado no navegador antes do envio.
// Aparece na hora no story e na lista enquanto o vídeo carrega.
export async function capturePoster(file: File, maxSide = 1080): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("video"));
    });
    v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    await new Promise<void>((resolve) => {
      v.onseeked = () => resolve();
      setTimeout(resolve, 1500);
    });
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const frame = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.92),
    );
    return shrinkImage(frame, maxSide, 0.85, "image/jpeg");
  } finally {
    URL.revokeObjectURL(url);
  }
}
