"use server";

import { createClient } from "@/lib/supabase/server";

export async function sendSupport(
  restaurantId: string,
  input: { subject: string; whatsapp: string; message: string },
): Promise<{ error?: string }> {
  const subject = String(input.subject ?? "").trim().slice(0, 120);
  const message = String(input.message ?? "").trim().slice(0, 3000);
  const whatsapp = String(input.whatsapp ?? "").trim().slice(0, 30) || null;
  if (!subject || !message) return { error: "Preencha o assunto e a descrição." };
  const supabase = await createClient();
  const { error } = await supabase.from("support_requests").insert({ restaurant_id: restaurantId, subject, whatsapp, message });
  if (error) return { error: "Não foi possível enviar. Tente de novo ou chame no WhatsApp." };
  return {};
}
