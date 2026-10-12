"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string; id?: string; code?: string };

const MAX_TABLES = 200;
const FAIL = "Não foi possível salvar. Tente de novo.";

// Mesas: cada uma tem um código curto e fixo, que vai no QR Code impresso.
export async function addTable(restaurantId: string, label: string): Promise<Result> {
  const name = String(label ?? "").trim().slice(0, 40);
  if (!name) return { error: "Dê um nome para a mesa." };
  const supabase = await createClient();
  const { data: rows, error: listError } = await supabase
    .from("dining_tables")
    .select("label")
    .eq("restaurant_id", restaurantId);
  if (listError) return { error: FAIL };
  const all = rows ?? [];
  if (all.length >= MAX_TABLES) return { error: `Limite de ${MAX_TABLES} mesas.` };
  if (all.some((r) => r.label.toLowerCase() === name.toLowerCase())) {
    return { error: "Já existe uma mesa com esse nome." };
  }
  const { data, error } = await supabase
    .from("dining_tables")
    .insert({ restaurant_id: restaurantId, label: name })
    .select("id, code")
    .single();
  if (error || !data) return { error: FAIL };
  revalidatePath("/painel/mesas");
  return { id: data.id, code: data.code };
}

export async function removeTable(restaurantId: string, id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("dining_tables").delete().eq("id", id).eq("restaurant_id", restaurantId);
  if (error) return { error: FAIL };
  revalidatePath("/painel/mesas");
  return {};
}
