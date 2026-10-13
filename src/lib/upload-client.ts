// Envia um arquivo do painel para /api/upload e devolve a URL pública dele.
export async function uploadFile(restaurantId: string, name: string, file: Blob): Promise<string> {
  const q = new URLSearchParams({ restaurant: restaurantId, name });
  const res = await fetch(`/api/upload?${q}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Não foi possível enviar o arquivo. Tente de novo.");
  return data.url;
}
