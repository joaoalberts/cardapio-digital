// Reduz a imagem no navegador antes de enviar (WebP mantém transparência e pesa pouco).
// Navegador sem codificador WebP (Safari antigo) devolve PNG enorme: aí vai `fallback`.
export async function shrinkImage(
  file: Blob,
  maxSide: number,
  quality = 0.85,
  fallback: "image/jpeg" | "image/png" = "image/png",
): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const encode = (type: string) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), type, quality),
    );
  const webp = await encode("image/webp");
  return webp.type === "image/webp" || fallback === "image/png" ? webp : encode(fallback);
}

export const extOf = (b: Blob) => (b.type === "image/webp" ? "webp" : b.type === "image/jpeg" ? "jpg" : "png");

export const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
