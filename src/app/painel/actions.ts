"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidSlug, slugify } from "@/lib/slug";
import type { FormState } from "@/app/(auth)/actions";

export async function createRestaurant(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("restaurant_name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  if (!name) return { error: "Informe o nome do restaurante." };
  if (!isValidSlug(slug)) {
    return { error: "O endereço precisa ter de 3 a 40 letras, números ou hífens." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_restaurant", { p_name: name, p_slug: slug });
  if (error) {
    if (error.code === "23505") return { error: "Esse endereço já está em uso. Escolha outro." };
    return { error: "Não foi possível criar o restaurante. Tente de novo." };
  }
  await supabase.auth.updateUser({ data: { pending_restaurant: null } });
  revalidatePath("/painel");
  redirect("/painel");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}
