"use server";

import { isMember } from "@/lib/auth";
import { ownsFile, removeFiles } from "@/lib/storage";

// Arquivos enviados e não salvos (o dono fechou sem salvar): apaga do Blob.
export async function discardFiles(restaurantId: string, urls: string[]) {
  if (!Array.isArray(urls) || !(await isMember(restaurantId))) return;
  await removeFiles(urls.filter((u) => typeof u === "string" && ownsFile(restaurantId, u)));
}
