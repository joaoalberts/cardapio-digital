// Reduz a imagem no navegador antes de enviar (WebP mantém transparência e pesa pouco).
export async function shrinkImage(file: Blob, maxSide: number, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/webp", quality),
  );
}

export const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
