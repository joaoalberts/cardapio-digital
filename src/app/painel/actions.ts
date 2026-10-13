"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserId, endSession } from "@/lib/auth";
import { createRestaurantFor, slugTaken } from "@/lib/restaurants";
import { isValidSlug, slugify } from "@/lib/slug";
import type { FormState } from "@/app/(auth)/actions";

export async function createRestaurant(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("restaurant_name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  if (!name) return { error: "Informe o nome do restaurante." };
  if (!isValidSlug(slug)) {
    return { error: "Esse endereço não pode ser usado. Use de 3 a 40 letras, números ou hífens." };
  }

  const userId = await currentUserId();
  if (!userId) redirect("/entrar");
  if (await slugTaken(slug)) return { error: "Esse endereço já está em uso. Escolha outro." };
  try {
    await createRestaurantFor(userId, name, slug);
  } catch {
    return { error: "Não foi possível criar o restaurante. Tente de novo." };
  }
  revalidatePath("/painel");
  redirect("/painel");
}

export async function signOut() {
  await endSession();
  redirect("/entrar");
}
