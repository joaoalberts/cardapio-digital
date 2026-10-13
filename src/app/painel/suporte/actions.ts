"use server";

import { currentUserId, isMember } from "@/lib/auth";
import * as db from "@/lib/db/nocodb";

export async function sendSupport(
  restaurantId: string,
  input: { subject: string; whatsapp: string; message: string },
): Promise<{ error?: string }> {
  const subject = String(input.subject ?? "").trim().slice(0, 120);
  const message = String(input.message ?? "").trim().slice(0, 3000);
  const whatsapp = String(input.whatsapp ?? "").trim().slice(0, 30) || null;
  if (!subject || !message) return { error: "Preencha o assunto e a descrição." };
  const userId = await currentUserId();
  if (!userId || !(await isMember(restaurantId))) return { error: "Entre de novo no painel." };
  try {
    await db.insertOne("support_requests", { restaurant_id: restaurantId, user_id: userId, subject, whatsapp, message });
  } catch {
    return { error: "Não foi possível enviar. Tente de novo ou chame no WhatsApp." };
  }
  return {};
}
